import type { DigestContent } from './assemble'

export interface DigestEmailContent {
  subject: string
  html: string
  text: string
}

export interface RenderDigestOptions {
  /** Where the email's "open the app" link points, e.g. `https://podmonitor.example.com/dashboard`. */
  appUrl: string
}

/** Insight text and episode/podcast titles come from the LLM and RSS feeds — never trust them raw in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderEpisodeSectionHtml(episode: DigestContent['episodes'][number]): string {
  const insightItems = episode.topInsights
    .map((insight) => `<li style="margin:0 0 4px;">${escapeHtml(insight.text)}</li>`)
    .join('')

  return `
    <tr>
      <td style="padding:16px 0;border-top:1px solid #e5e5e5;">
        <h2 style="margin:0 0 8px;font-size:16px;">${escapeHtml(episode.podcastTitle)} — ${escapeHtml(episode.episodeTitle)}</h2>
        <p style="margin:0 0 8px;color:#333;">${escapeHtml(episode.tldr)}</p>
        ${insightItems ? `<ul style="margin:0;padding-left:20px;color:#333;">${insightItems}</ul>` : ''}
      </td>
    </tr>`
}

function renderEpisodeSectionText(episode: DigestContent['episodes'][number]): string[] {
  return [
    `${episode.podcastTitle} — ${episode.episodeTitle}`,
    episode.tldr,
    ...episode.topInsights.map((insight) => `- ${insight.text}`),
    '',
  ]
}

/**
 * Pure render of assembled digest content into an email (subject/html/text) — no I/O, no
 * provider. This is what dry-run mode calls: it produces the exact email a real send would
 * use, so a QA reviewer (or the dry-run render test) sees the real output either way.
 */
export function renderDigestEmail(
  content: DigestContent,
  options: RenderDigestOptions,
): DigestEmailContent {
  const episodeCount = content.episodes.length
  const subject = `Your Podmonitor digest: ${episodeCount} new episode${episodeCount === 1 ? '' : 's'}`

  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#111;">
    <h1 style="font-size:20px;">Your digest — week of ${content.weekOf}</h1>
    <table role="presentation" style="width:100%;border-collapse:collapse;">
      ${content.episodes.map(renderEpisodeSectionHtml).join('')}
    </table>
    <p style="margin-top:24px;">
      <a href="${options.appUrl}">Open Podmonitor</a> to read the full summaries and insight links.
    </p>
  </body>
</html>`

  const text = [
    `Your Podmonitor digest — week of ${content.weekOf}`,
    '',
    ...content.episodes.flatMap(renderEpisodeSectionText),
    `Open the app: ${options.appUrl}`,
  ].join('\n')

  return { subject, html, text }
}
