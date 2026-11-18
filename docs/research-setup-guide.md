# Payor Compass: Research Guide

For coworkers who will research payers with Claude and fill in the Payor Compass database.

- **Part 1** gets you set up (one time, about 30 minutes).
- **Part 2** is how you use it day to day.

## How it works

1. You add a payer in the Payor Compass app.
2. You ask Claude to research it.
3. Claude saves **proposed values** (called *findings*) to a staging area. Each one has a source link and the exact quote that supports it. **Nothing goes into the live data yet.**
4. You review each finding and approve or reject it. Approving copies it into the live payer data and logs who approved it.
5. Claude records how it found each answer (the *playbook*), so it can find the same thing faster for the next payer and re-check it later.

## What works today

| Step | Status |
|---|---|
| Staging tables and the approval function | Done |
| Access limited to managers and admins | Done |
| Claude researching and saving findings | Needs the research instructions file (`CLAUDE.md`), in progress |
| Approving findings | **Needs the review page, not built yet.** Until then, findings can be saved but not approved |
| Daily re-checking of sources | Planned |

---

# Part 1: Getting set up

## Before you start, make sure you have

- Access to the GitHub repository `PaulwHeering/payor-compass`. Ask the project owner to add you as a collaborator.
- Access to the **Payor Compass** project in Supabase (not any other Supabase project).
- The Claude desktop app, with the Code tab.
- A job title in the app's job titles list with the **manager** or **admin** role. Without it you can browse but not edit or approve. The project owner manages this at `/admin/job-titles` in the app.

## Steps

### 1. Install the tools

Open Terminal and run these one at a time. If a command says `command not found: brew`, install Homebrew first from https://brew.sh.

```bash
brew install git node supabase/tap/supabase
```

Don't use `sudo` and don't use `npm install -g`. If something asks for an administrator password, stop and ask the project owner.

### 2. Get the project onto your computer

```bash
cd ~/Desktop
git clone https://github.com/PaulwHeering/payor-compass.git
cd payor-compass
npm install
```

### 3. Add the environment file

The app needs a `.env.local` file in the project's top folder with two lines:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Ask the project owner to send you these values securely (not in email or open chat). **You do not need, and should never be given, the Supabase service key.** If anyone offers it, decline.

### 4. Connect the Supabase command line to Payor Compass

```bash
supabase login
```

This opens a browser to sign in. Then link the project:

```bash
supabase link --project-ref dsuzduetrcscspthnzdf
```

Check that it is the right project:

```bash
supabase projects list
```

The linked project must be named **Payor Compass**. If you see a data warehouse or any other name, stop and ask.

### 5. Open the project in Claude Code

In the Claude desktop app, go to the Code tab, start a new session, and choose the `payor-compass` folder. Claude can now read the project instructions and use the database connection.

### 6. Check that it works

Ask Claude:

> List the payers currently in the Payor Compass database. Don't change anything.

You should get a list of payers, or an empty list if none exist yet. If you get a permissions or "project not found" error, repeat step 4 and tell the project owner.

You're set up.

---

# Part 2: Using it

## Each research task

### 1. Add the payer

In the Payor Compass app, add the payer from the home page. This creates the payer record Claude will attach its findings to.

### 2. Start a Claude Code session in the project folder

Open the Code tab and start a new session in `payor-compass`. Start a fresh session for each payer. It keeps the work clean.

### 3. Ask for the research

Name the **payer** and the **fields**. Field names match the labels in the app, grouped under Profile, Links, Staff & Coding, Authorizations, Clinical Services, Credentialing and Billing.

> Research Aetna. Fields: timely filing limit, prior authorization submission process, telehealth allowance.

You can also ask for a whole section: "Research Aetna's Billing section."

Claude will:
- check its playbook notes for those fields first
- research from primary sources (the payer's provider manual, clinical policy and portal) before anything else
- save each answer as a pending finding with the source link and the exact supporting quote
- say plainly when it **can't find** something instead of guessing

### 4. Review each finding

For every finding:
- Open the link and check the quote is really there.
- Check it is the right plan, right state and current year. Payers publish different rules for Medicaid and commercial plans, and old manuals stay online.
- **Approve** if the value is right.
- **Reject** with a short reason, such as "this is the 2022 manual" or "this is the Medicaid plan, not commercial". Rejection reasons are the most useful thing you can give Claude, because they go into the playbook.
- Mark **needs info** to have Claude dig further.

> **Not available yet:** approving needs the review page. Until it is built, ask Claude to show you the pending findings so you can check them, but they can't be approved.

### 5. Teach Claude (update the playbook)

After a review, say:

> Update the playbook from this review.

Claude will propose notes such as where the answer was found and what to avoid. Read them and approve the ones that are right. Next time Claude researches that field, for any payer, it starts from those notes.

### 6. Repeat for the next payer

Start a new session and repeat. The playbook makes each payer faster than the last.

## Daily checking (planned)

Once there is approved data, a scheduled check will revisit each source. If a page changed, Claude will extract the value again and add a new pending finding marked as a change. **Nothing is overwritten automatically.** You approve changes the same way as new findings.

## If something goes wrong

| What you see | What to do |
|---|---|
| Claude says it can't connect to the database | Repeat Part 1 step 4. Check `supabase projects list` shows Payor Compass |
| "Only managers and admins can approve findings" | Your job title isn't a manager or admin role. Ask the project owner |
| Claude saved a value with no source or quote | It shouldn't be able to. Reject it and tell the project owner |
| The app says "Sign-in could not be completed" | Tell the project owner. It is a server problem, not something you did |
| Anything unexpected | Stop and ask. Nothing in staging is live, so waiting costs nothing |

## Rules of thumb

- Every value needs a source and a quote. No source, no finding.
- Prefer payer documents over third-party websites.
- Never paste passwords, member information or signed contracts into a session unless the project owner has confirmed it is allowed.
- Never ask Claude to write directly to the live payer data. Everything goes through staging and review.
- If something looks wrong, reject it. A rejection costs nothing. A bad approved value does.
