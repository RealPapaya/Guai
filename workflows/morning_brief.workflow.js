export const meta = {
  name: 'guai-morning-brief',
  description: 'Compose and voice Guai\'s executive morning brief: refresh, render from the portable core, polish tone (Sonnet), and emit a single headline push.',
  phases: [
    { title: 'Gather', detail: 'a light freshness sweep so the brief is current' },
    { title: 'Compose', detail: 'render + Opus prioritization + Sonnet voicing + headline' },
  ],
};

phase('Gather');
await agent(
  'Refresh Guai before the brief: from the repo root (D:/Google AI/guai) run '
  + '`node scripts/run-sweep.mjs --trigger=brief`. Return its stdout summary.',
  { label: 'freshness-sweep', phase: 'Gather' }
);

phase('Compose');
// Deterministic render is the source of truth for facts; the LLM only ranks + voices it.
const raw = await agent(
  'Render Guai\'s morning brief: from the repo root run `node scripts/run-brief.mjs`. '
  + 'Return its Markdown output verbatim.',
  { label: 'render', phase: 'Compose' }
);

const ranked = await agent(
  'You are Guai\'s chief of staff. Run `node scripts/list-hot.mjs` for the hot set, then take '
  + 'the rendered brief below and re-order the Priority section by what most deserves the '
  + 'principal\'s attention, attaching a crisp next step to each. Do NOT invent facts. '
  + 'Brief:\n\n' + raw,
  { label: 'chief-prioritize', agentType: 'chief-of-staff', model: 'opus', phase: 'Compose' }
);

const voiced = await agent(
  'You are digest-writer. Improve the tone and concision of this brief WITHOUT adding any '
  + 'fact, number, or recommendation not already present. Keep the section structure. '
  + 'Then provide a one-line headline (<=200 chars) for a single morning push.\n\n' + ranked,
  {
    label: 'digest-writer', agentType: 'digest-writer', model: 'sonnet', phase: 'Compose',
    schema: { type: 'object', required: ['brief', 'headline'], additionalProperties: true, properties: { brief: { type: 'string' }, headline: { type: 'string' } } },
  }
);

log('brief composed; headline ready for a single morning push');
return voiced; // { brief, headline } — the skill sends the headline via PushNotification
