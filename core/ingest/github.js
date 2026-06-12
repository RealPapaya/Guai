// GitHub monitor. Turns repo state into normalized findings. Deterministic —
// the pure normalizers (testable with fixtures, no network) are separated from the
// thin fetch client. Uses Node's global fetch; no `gh` CLI dependency.

const DAY = 864e5;
const FAIL = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const round = (n) => Math.round(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ageDays = (iso, clock) => (clock - Date.parse(iso)) / DAY;

// ---- pure normalizers -------------------------------------------------------

export function normalizePulls(repo, pulls, cfg, clock) {
  const stalePrDays = cfg.github?.stalePrDays ?? 7;
  const out = [];
  for (const pr of pulls ?? []) {
    const updatedDays = ageDays(pr.updated_at, clock);
    const createdDays = ageDays(pr.created_at, clock);
    const reviewers = (pr.requested_reviewers?.length ?? 0) + (pr.requested_teams?.length ?? 0);
    const draft = !!pr.draft;
    const base = {
      source: 'dev', target_ref: repo, key: `pr:${repo}#${pr.number}`,
      detail: {
        url: pr.html_url, number: pr.number, author: pr.user?.login,
        title: pr.title, updatedDays: round(updatedDays), createdDays: round(createdDays),
        draft, reviewers,
      },
    };

    if (reviewers > 0 && !draft) {
      out.push({
        ...base, kind: 'review_backlog',
        severity: createdDays > 2 * stalePrDays ? 3 : 2,
        title: `PR #${pr.number} "${pr.title}" awaiting review (${round(createdDays)}d, ${reviewers} reviewer${reviewers > 1 ? 's' : ''})`,
      });
    } else if (!draft && updatedDays >= stalePrDays) {
      out.push({
        ...base, kind: 'stale_pr',
        severity: clamp(1 + Math.floor(updatedDays / stalePrDays), 1, 3),
        title: `PR #${pr.number} "${pr.title}" stale ${round(updatedDays)}d`,
      });
    } else if (draft && createdDays > 2 * stalePrDays) {
      out.push({
        ...base, kind: 'stale_pr', severity: 1,
        title: `Draft PR #${pr.number} "${pr.title}" open ${round(createdDays)}d`,
      });
    }
    // else: healthy active PR → no finding.
  }
  return out;
}

export function normalizeRuns(repo, runs, defaultBranch, cfg, clock) {
  // Keep only completed push runs on the default branch; the LATEST run per
  // workflow is what counts (an old failure that has since gone green is not a finding).
  const relevant = (runs ?? [])
    .filter((r) => r.event === 'push' && r.head_branch === defaultBranch && r.status === 'completed')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const latestByWorkflow = new Map();
  for (const r of relevant) if (!latestByWorkflow.has(r.name)) latestByWorkflow.set(r.name, r);

  const out = [];
  for (const r of latestByWorkflow.values()) {
    if (!FAIL.has(r.conclusion)) continue;
    out.push({
      source: 'dev', kind: 'ci_failure', target_ref: repo,
      key: `ci:${repo}:${defaultBranch}:${r.name}`,
      severity: 3, timeCritical: true,
      title: `CI failing: ${r.name} on ${defaultBranch}`,
      detail: {
        url: r.html_url, runId: r.id, workflow: r.name, branch: defaultBranch,
        headSha: r.head_sha?.slice(0, 7), conclusion: r.conclusion, ranAt: r.created_at,
      },
    });
  }
  return out;
}

/** Combine pulls + runs (+ optional commits) into findings + light activity stats. */
export function normalizeRepo({ repo, repoInfo, pulls, runs, commits = [], sinceTs = 0 }, cfg, clock = Date.now()) {
  const defaultBranch = repoInfo?.default_branch ?? 'main';
  const findings = [
    ...normalizePulls(repo, pulls, cfg, clock),
    ...normalizeRuns(repo, runs, defaultBranch, cfg, clock),
  ];
  const commitsSince = (commits ?? []).filter(
    (c) => !sinceTs || Date.parse(c.commit?.author?.date ?? c.commit?.committer?.date ?? 0) >= sinceTs
  ).length;
  return {
    findings,
    stats: { repo, defaultBranch, openPRs: (pulls ?? []).length, ciFailing: findings.filter((f) => f.kind === 'ci_failure').length, commitsSince },
  };
}

// ---- live client ------------------------------------------------------------

function ghClient(token, apiBase = 'https://api.github.com') {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'guai-chief-of-staff',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return async (path) => {
    const res = await fetch(apiBase + path, { headers });
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const hint = res.status === 403 && remaining === '0' ? ' (rate limit — set GITHUB_TOKEN)' : '';
      throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}${hint}`);
    }
    return res.json();
  };
}

export async function fetchRepoFindings(repo, cfg, { token = null, sinceTs = 0 } = {}, clock = Date.now()) {
  const gh = ghClient(token, cfg.github?.apiBase);
  const perPage = cfg.github?.perPage ?? 50;
  const repoInfo = await gh(`/repos/${repo}`);
  const defaultBranch = repoInfo.default_branch;
  const [pulls, runsResp, commits] = await Promise.all([
    gh(`/repos/${repo}/pulls?state=open&per_page=${perPage}`),
    gh(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(defaultBranch)}&per_page=20&event=push`),
    sinceTs
      ? gh(`/repos/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&since=${new Date(sinceTs).toISOString()}&per_page=100`).catch(() => [])
      : Promise.resolve([]),
  ]);
  return normalizeRepo(
    { repo, repoInfo, pulls, runs: runsResp.workflow_runs ?? [], commits, sinceTs },
    cfg, clock
  );
}
