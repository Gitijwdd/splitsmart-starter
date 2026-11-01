# SplitSmart — starter

The starter app for the **deepEntra Academy · Build & Ship It** course. It's a basic
expense-splitter (one group, a list of expenses, a running total). Over the course you'll
give it an **AI brain** (Hour 3) and a **real database with logins** (Hour 5), then polish
and ship it to your own domain (Hours 7–8).

This is the **"My Group"** app you see on the course slide — the basic version you deploy in
Hour 2, before you add the magic.

<p align="center"><b>SplitSmart · My Group</b><br/>🍽️ Dinner — paid by Aisha — ₹1,800<br/>🚕 Cab — paid by Raj — ₹400<br/><b>Total ₹2,200</b></p>

---

## Hour 2 — get it on your laptop & ship it

### 1. Fork this repo
Click **Fork** (top-right) → you get your own copy under your GitHub account.

### 2. Clone your fork and open it
Ask your AI assistant: *"Clone my fork and open it in VS Code."* Or, in a terminal:

```bash
git clone https://github.com/<your-username>/splitsmart-starter.git
cd splitsmart-starter
```

### 3. Install the app's parts
```bash
npm install
```

### 4. Run it
```bash
npm run dev
```
Open **http://localhost:3000** — SplitSmart is alive on your laptop. 🎉

### 5. Make one tiny change
Ask your AI: *"Change the title to 'Raj's SplitSmart' and keep the button deepEntra blue."*
Save → the browser updates instantly. Then snapshot it:

```bash
git add -A
git commit -m "My first change"
git push
```

### 6. Put it on the internet — Vercel 🚀

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/maheshbaxi/splitsmart-starter)

- Import your fork into **[Vercel](https://vercel.com/new)** (it finds your GitHub repo).
- Click **Deploy** → ~1 minute → you get a live `…vercel.app` link. Open it on your phone and
  text it to a friend.
- From now on, **every `git push` redeploys your live site automatically.**

> 🔒 **Keep your API keys private** — never paste them into a screenshot, a commit, or a shared
> doc. Secrets go in Vercel's **Environment Variables** (and in `.env.local` locally, which is
> git-ignored). See `.env.example`.

---

## Enable group chat

Group chat uses Supabase Database and Realtime. In the Supabase dashboard, open **SQL Editor**,
run or rerun `supabase/schema_hour6.sql`, then reload the app. This re-runnable schema creates
the group-message and username-profile tables, restricts access to group members, and adds the
tables to the Realtime publication. It also enables member-based payer selection and stores
equal or custom per-person expense shares. Rerun the schema after pulling changes to add the
shares column, the group rename permission, and recipient-only debt reminders and payment
confirmations. Net balances are synced to the reminder feed; members who owe money see the amount
and payee in their notification tab and can mark it paid to notify the payer, including a live
bell badge while the app is open. Group members can open the group actions menu to
view the member list, rename the group, or remove themselves from the group list. The selected
group's notification history can be permanently cleared with
**Clear all** in the app; the action requires confirmation and affects every member.

## What's inside

| | |
| --- | --- |
| **Framework** | [Next.js](https://nextjs.org) (App Router) + React |
| **The app** | `app/page.js` — the whole SplitSmart UI (one file to start) |
| **Styles** | `app/globals.css` + inline styles (deepEntra blue) |
| **Data** | Saved in your browser (`localStorage`) for now — you'll move it to a real database in Hour 5 |

## Scripts
```bash
npm run dev     # local dev → http://localhost:3000
npm run build   # production build
npm run start   # run the production build
```

---

Made for **deepEntra Academy** · [academy.deepentra.ai](https://academy.deepentra.ai)
