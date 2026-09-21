const REPO = "https://github.com/malasadongegg/TrackHour";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/**
 * A plain-language description of what TrackHour actually does with data. Keep it
 * in step with the code: what is stored where is decided in web/src/lib/db.ts,
 * web/src/pages/AccountPage.tsx, supabase/migrations and extension/. This is a
 * description of the app's behavior, not legal advice.
 */
export function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-7 rounded-lg border border-line bg-panel p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Privacy</h1>
        <p className="text-xs text-muted">Last updated September 21, 2026</p>
      </header>

      <p className="text-sm leading-relaxed text-ink">
        TrackHour shows how much time you spend with AI tools. The short version: your chats stay on your device, and the only thing that ever
        leaves it is a small set of totals, and only if you sign in and choose to save them.
      </p>

      <Section title="What stays on your device">
        <p>
          When you import a ChatGPT or Claude export, the file is read in your browser. TrackHour keeps only the timestamps and counts it needs
          (when messages were sent, how many). It does not keep your messages, conversation titles or files. This is stored in your browser's
          own storage (IndexedDB) and is never sent anywhere.
        </p>
        <p>
          The optional Claude Code hook and the optional browser extension also work only on your computer. They record times and counts, never
          prompts, replies, code or page content, and write to a file or to the browser's extension storage that only you can open.
        </p>
      </Section>

      <Section title="What is uploaded if you sign in and save">
        <p>Nothing is uploaded until you press Save on the Account page, and the Account page shows you the exact data first. It is:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your card design (theme, layout, colors, title).</li>
          <li>Totals per tool: hours, session and conversation counts, streaks, first and last used dates.</li>
          <li>Minutes of use per day for the last 30 weeks.</li>
          <li>The card name you choose, and whether your card is public.</li>
        </ul>
        <p>
          Cards are private until you say otherwise. If you make your card public, anyone with the link can see the card and these numbers. The
          record also carries an internal account identifier, which is technically readable for public cards.
        </p>
      </Section>

      <Section title="Sign-in">
        <p>
          Sign-in uses your GitHub account through Supabase. Supabase stores the basic account details GitHub provides, such as your username
          and, if your GitHub account shares it, your email address. TrackHour never sees your GitHub password and does not access your
          repositories.
        </p>
      </Section>

      <Section title="Who handles data">
        <ul className="list-disc space-y-1 pl-5">
          <li>Vercel hosts the site and the card image link. Like any host, it may keep request logs that include IP addresses.</li>
          <li>Supabase provides sign-in and stores the saved totals in a database.</li>
          <li>GitHub authenticates you when you sign in.</li>
        </ul>
        <p>There are no ads, no analytics and no tracking cookies. Your sign-in session is kept in your browser's local storage.</p>
      </Section>

      <Section title="Deleting your data">
        <ul className="list-disc space-y-1 pl-5">
          <li>Saved totals: use Delete from server on the Account page.</li>
          <li>Data in this browser: use Delete import or Wipe everything on the dashboard.</li>
          <li>Extension data: use Delete all tracked time in the extension popup.</li>
          <li>
            Your sign-in record: deleting saved totals removes your profile but not the sign-in record itself. To have that removed too, open an
            issue at the link below and it will be deleted.
          </li>
        </ul>
      </Section>

      <Section title="Questions">
        <p>
          TrackHour is open source. You can read exactly what it does, and report problems or ask for your account to be removed, at{" "}
          <a href={REPO} className="text-accent hover:underline" rel="noreferrer noopener" target="_blank">
            github.com/malasadongegg/TrackHour
          </a>
          .
        </p>
      </Section>

      <p className="border-t border-line/60 pt-4 text-xs text-muted">
        This page describes how the app behaves. It is not legal advice, and the numbers on a card are self-reported and not verified.
      </p>
    </article>
  );
}
