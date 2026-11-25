# Payor Compass: Research Guide

For coworkers who research payers and fill in the Payor Compass database. You do everything in the web app.

## How it works

1. You pick a payer and the fields to research on the **Research** page.
2. Claude searches the web and reads the payer's documents. For each field it proposes a value with a source link and an exact quote.
3. **The server downloads each source and checks that the quote is really in it.** Quotes that can't be found are rejected before you ever see them.
4. You review each finding on the **Review findings** page and approve or reject it. Approving publishes it to the live data and records who approved it.
5. Claude remembers. It is shown where approved answers were found before, your rejection reasons, and any instructions your team has written, the next time it researches that field.

**Nothing goes live until you approve it.**

---

# Part 1: Getting set up (for coworkers)

There is nothing to install.

1. Open the Payor Compass site and sign in with your Microsoft work account.
2. You need a **manager** or **admin** role to start research and approve findings. Your role comes from your job title. If you can't see the **Research** and **Review findings** buttons on the home page, ask the project owner to add your job title (at `/admin/job-titles`).

That's all.

---

# Part 2: Using it

## What Claude researches

Every field shows a badge saying how it gets its value, and the Research page tags each field **Web** or **Uploaded files**:

- **Researched by Claude** (Web): Claude searches the internet.
- **From uploaded files**: Profile details (TIN, states, contract dates, renewal/termination terms, contacts), EFT / claim form / Waystar ID / claims address, the contracting model (individual vs. company NPI), the fee schedule link and similar. Claude never searches the web for these. It reads only the PDFs uploaded for that payer. Upload the contract first: open the payer, then **Uploaded Files → Upload PDF** (managers and admins). Until a payer has a file, these fields are greyed out on the Research page. Scanned PDFs with no text layer can't be read.
- **Web if Medicaid · files if commercial** (contracted codes, staff level per code) and **On hold** (Clinical Services) are not researched.

Admins can change any field under **Field Sources** in the account menu on the home page (`/admin/field-sources`).

## Research a payer

1. Make sure the payer exists. If not, add it with **+ New Payer**.
2. Click **Research** on the home page.
3. Choose the payer. Tick the fields you want, or tick a whole section.
   - Start small: pick 3 to 5 fields the first time so you can see how it works.
   - You can choose up to 25 fields at a time.
4. Click **Research N fields**.
5. **Keep the page open while it runs.** Each field takes a minute or two. You'll see each one go from Waiting to Researching to Done. If you close the page, the remaining fields wait, and they continue when you open the Research page again.

If a field fails, click **Retry**. If you started the wrong thing, click **Stop waiting fields**.

## Review the findings

Click **Review findings** (the number shows how many are waiting). For each finding, check:

- **The quote is shown with a green ✓** when the server found it in the document. If you see an amber "Not verified automatically", the server couldn't download or read the document (some sites block automated downloads). Open the link and check the quote by hand.
- **The scope is right.** Payers publish different rules by state, line of business (commercial, Medicaid, Medicare Advantage), plan and year. Claude's note says what it believes the source covers. Check it fits your contract.
- **A blue "Changes a live value" badge** means approving will replace what is published. The current value is shown above the proposal.

Then:

- **Approve and publish** if it's right. You can edit the value first.
- **Reject** with a reason. Good reasons teach Claude ("this is the 2022 manual", "this is for Medicaid, not commercial").
- **Needs more info** if you want it looked at again.

"Not found" findings mean Claude looked and couldn't find a reliable source. That's a valid answer, and the note shows where it looked.

## Teach Claude where to look

Claude gets better the more you tell it. There are three kinds of memory, and you only write one of them:

- **Where answers were found before (automatic).** When you approve a finding, the app remembers its source. Next time, Claude is told "this was found at this link for this payer, start there and check whether it changed." For other payers it's told which kinds of documents answered the field.
- **Rejection reasons (automatic).** When you reject a finding with a reason, Claude sees that reason the next time it researches that field.
- **Instructions you write (the Playbooks page).** Click **Teach Claude where to look** on the Research page. Choose a field, and choose whether it applies to **all payers** or **only one**. Then fill in any of:
  - *Where to look*, such as "Check the provider manual, Claims section, before looking anywhere else."
  - *Sources to trust or avoid*
  - *Search terms that work*
  - *Watch out for*, such as "The Medicaid plan has different rules. Only use the commercial documents."

Instructions take effect on the next research run. They are advice: Claude still has to find the document and quote it, and the server still checks the quote. Use "only one payer" when the tip is specific, like "for Cigna, use the State Supplement". Anyone can read instructions, and managers and admins can edit them.

## Rules of thumb

- Every value needs a source and a quote. The server won't save a quote it can't find in the document.
- Claude's value is a proposal. Check it against the source.
- If something looks wrong, reject it. A rejection costs nothing. A bad approved value does.
- Don't try to get Claude to research member information, or paste passwords into the app. Upload contracts only through **Uploaded Files** on the payer page (they're stored privately and only signed-in users can open them). Findings from a file quote 1-3 sentences of it as proof.
- **Findings from an uploaded file** show the file name and an **Open file** link instead of a web link. Check that a later amendment hasn't changed the value.

## If something goes wrong

| What you see | What to do |
|---|---|
| No Research or Review buttons | Your role isn't manager or admin. Ask the project owner |
| "Research is not set up yet" | The Claude API key is missing on the server. Tell the project owner |
| A field shows Failed with a rate-limit message | Wait a minute and click Retry |
| "Not verified automatically" on a finding | Open the link and check the quote by hand, or reject it |
| Anything unexpected | Stop and ask. Nothing is live until approved |

---

# For the project owner

## One-time setup

1. **Apply the database migration** (`supabase db push --remote`), then deploy.
2. **Create a Claude API key** in the Anthropic console. Set a **monthly spend limit** on it first.
3. **Add it to Vercel** as `ANTHROPIC_API_KEY` for Production (Settings, then Environment Variables). Add it in the dashboard. Don't paste it in chat or a command. Redeploy so it takes effect.
4. Optional: set `RESEARCH_MODEL` to change the model. It defaults to `claude-opus-5-5`, the most careful. A cheaper model such as `claude-sonnet-5-5` costs less and may be fine for simple fields.
5. Add `ANTHROPIC_API_KEY` to `.env.local` too if you want to test research locally.

## Good to know

- **Cost.** Each field is one research session with web search. Cost depends on the model and how hard the field is. Watch the first runs in the Anthropic console, then set the spend limit.
- **Safety.** Claude can only search, read pages and submit a finding. It can't touch the database. The server saves findings as the signed-in user, so database rules still apply. Source links are checked so they can't reach internal addresses.
- **Research needs a manager or admin.** Findings are saved in the same staging tables the review page reads.
- **Time limit.** Each field runs in its own request of up to 5 minutes. Fields that run out of time can be retried.
- **Daily re-checking** of sources isn't built yet.

## Advanced: researching from Claude Code

The `research-payer` skill in `.claude/skills` does the same research from a terminal session, and is useful for testing new fields and changing the research instructions. It needs the Supabase CLI linked to the Payor Compass project. See `CLAUDE.md` for its rules.
