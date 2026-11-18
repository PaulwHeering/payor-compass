# Payor Compass: Research Setup Guide

For the Director of Payer Relations and Contracts. This guide gets you from nothing to running
your first payer research session with Claude.

## How it works (the short version)

1. You add a payer.
2. You ask Claude to research it in Claude Code.
3. Claude writes **proposed values** (called *findings*) into a staging area, each with a source link and the exact quote that supports it. **Nothing goes into the live data yet.**
4. You review each finding and approve or reject it. Approving copies it into the live payer data and logs who approved it.
5. Claude records how it found each answer (the *playbook*), so it can find the same thing faster for the next payer and re-check it later.

## One-time setup

You need accounts on GitHub, Vercel, and Supabase (you have these) and the Claude desktop app with the Code tab.

### 1. Get the project onto your computer

In the Claude desktop app, open the Code tab and ask Claude: "Clone https://github.com/PaulwHeering/payor-compass to my Desktop." Or, in a terminal:

```bash
git clone https://github.com/PaulwHeering/payor-compass.git
cd payor-compass
npm install
```

### 2. Add the environment file

The app needs a `.env.local` file with the Supabase URL and keys. This file is not in GitHub on purpose. Ask the project owner to send it to you securely (not by email or chat) and save it in the project's top folder.

### 3. Open the project in Claude Code

In the Claude desktop app, Code tab, start a new session and choose the `payor-compass` folder. Claude can now read the project files, including the research instructions.

### 4. Connect Claude to the Payor Compass database

Claude needs the Supabase connection for the **Payor Compass** project, not any other Supabase project you have access to. Check the project name when you connect it. If you see a data warehouse or any other project, stop and ask.

> **Open item:** the project owner still has to finish the database connection for your account. Until then, Claude can draft research but can't save findings.

## Running a research session

Start a new Claude Code session in the project folder and say something like:

> Research Aetna. Fields: timely filing limit, prior authorization submission process, telehealth allowance.

Good requests name the **payer** and the **fields**. Field names match the labels in the app (Profile, Links, Staff & Coding, Authorizations, Clinical Services, Credentialing, Billing).

Claude will:
- look up its playbook notes for those fields first
- research from primary sources (the payer's provider manual, clinical policy, and portal) before anything else
- save each answer as a pending finding with the source link and the exact supporting quote
- say plainly when it **can't find** something rather than guess

## Reviewing findings

Review each finding against its source:
- Open the link and check the quote is really there.
- **Approve** if the value is right.
- **Reject** with a short reason ("this is the 2022 manual", "this is for the Medicaid plan, not commercial"). Rejection reasons are the most useful thing you can give Claude, because they go into the playbook.
- Mark **needs info** if you'd like Claude to dig further.

Until the review page is built, ask Claude in the session: "Show me the pending findings for Aetna," then tell it which to approve or reject. Approvals are saved under your name.

## Teaching Claude (the playbook)

After a review, ask Claude: "Update the playbook from this review." It will propose notes such as where the answer was found and what to avoid. Read them and approve the ones that are right. Next time Claude researches that field, for any payer, it starts from those notes.

## Daily checking (coming later)

Once there is approved data, a scheduled check will re-visit each source. If a page changed, Claude will re-extract the value and add a new pending finding marked as a change. **Nothing is overwritten automatically.** You approve changes the same way as new findings.

## Rules of thumb

- Every value needs a source and a quote. No source, no finding.
- Prefer payer documents over third-party websites.
- Don't paste passwords, member information, or contract PDFs into a session unless the project owner has confirmed that's allowed.
- If something looks wrong, reject it. A rejection costs nothing; a bad approved value does.
