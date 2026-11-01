'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export default function Home() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [groupDialog, setGroupDialog] = useState(null);
  const [groupInput, setGroupInput] = useState('');
  const [groupError, setGroupError] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadGroups = async () => {
    const { data } = await supabase.from('groups').select('*').order('created_at');
    setGroups(data || []);
    if (data && data.length) setGroupId((cur) => (data.find((g) => g.id === cur) ? cur : data[0].id));
  };
  useEffect(() => { if (session) loadGroups(); else { setGroups([]); setGroupId(''); } }, [session]);

  useEffect(() => {
    if (!session || !groupId) { setExpenses([]); return; }
    supabase.from('expenses').select('*').eq('group_id', groupId).order('created_at')
      .then(({ data }) => {
        const formatted = (data || []).map((e) => ({
          ...e,
          people: e.people && e.people.length > 0 ? e.people : ['You'],
          each: e.each || (e.amount / (e.people?.length || 1))
        }));
        setExpenses(formatted);
      });
  }, [session, groupId]);

  const signUp = async () => { setAuthMsg(''); const { error } = await supabase.auth.signUp({ email, password }); setAuthMsg(error ? error.message : 'Account created — you are signed in!'); };
  const signIn = async () => { setAuthMsg(''); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setAuthMsg(error.message); };
  const signOut = () => supabase.auth.signOut();

  const openGroupDialog = (action) => {
    setGroupDialog(action);
    setGroupInput('');
    setGroupError('');
  };

  const closeGroupDialog = () => {
    if (savingGroup) return;
    setGroupDialog(null);
    setGroupInput('');
    setGroupError('');
  };

  const submitGroupDialog = async (event) => {
    event.preventDefault();
    const value = groupInput.trim();
    if (!value || !groupDialog) return;

    setSavingGroup(true);
    setGroupError('');
    try {
      if (groupDialog === 'create') {
        const { data: newGroupId, error } = await supabase.rpc('create_group', { group_name: value });
        if (error) throw error;
        if (!newGroupId) throw new Error('Group creation did not return an ID.');

        await loadGroups();
        setGroupId(newGroupId);
      } else {
        const { data: joinedGroupId, error } = await supabase.rpc('join_group', { code: value });
        if (error) throw error;

        await loadGroups();
        setGroupId(joinedGroupId);
      }

      setGroupDialog(null);
      setGroupInput('');
    } catch (error) {
      setGroupError(error.message || 'Could not save the group. Please try again.');
    } finally {
      setSavingGroup(false);
    }
  };

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const currentGroup = groups.find((g) => g.id === groupId);

  const addExpense = async () => {
    const t = text.trim();
    if (!t || !groupId) return;
    try {
      const res = await fetch('/api/split', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentence: t }) });
      const data = await res.json();
      if (data.error) { alert('AI error: ' + data.error); return; }

      const payer = data.paidBy || 'You';
      const peopleList = data.people && data.people.length > 0 ? data.people : ['You'];
      const eachAmount = data.each || (data.amount / peopleList.length) || 0;

      const { data: rows, error } = await supabase.from('expenses')
        .insert({ 
          user_id: session.user.id, 
          group_id: groupId, 
          name: data.description || t, 
          paid_by: payer, 
          amount: data.amount || 0,
          people: peopleList,
          each: eachAmount
        })
        .select();
      
      if (error) { alert('Save error: ' + error.message); return; }

      setExpenses((list) => [...list, rows[0]]);
      setText('');
    } catch (e) { alert('Could not add: ' + e.message); }
  };

  const removeExpense = async (id) => { 
    await supabase.from('expenses').delete().eq('id', id); 
    setExpenses((list) => list.filter((e) => e.id !== id)); 
  };

  if (checking) return <main style={styles.page}><div style={styles.card}>Loading…</div></main>;

  if (!session) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}><div style={styles.brand}><div style={styles.logo}>S</div><div style={styles.title}>SplitSmart</div></div></div>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>Sign in to see your groups on any device.</p>
          <input style={styles.input2} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input style={styles.input2} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ characters)" />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={styles.authBtn} onClick={signUp}>Sign up</button>
            <button style={styles.authBtnAlt} onClick={signIn}>Sign in</button>
          </div>
          {authMsg && <div style={{ marginTop: 12, fontSize: 13, color: '#1C5FD4' }}>{authMsg}</div>}
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.brand}><div style={styles.logo}>S</div><div style={styles.title}>SplitSmart</div></div>
          <button style={styles.signout} onClick={signOut}>Sign out</button>
        </div>

        <div style={styles.groupBar}>
          <select style={styles.select} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.length === 0 && <option value="">No groups yet</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button style={styles.gbtn} onClick={() => openGroupDialog('create')}>+ New</button>
          <button style={styles.gbtn} onClick={() => openGroupDialog('join')}>Join</button>
        </div>
        {currentGroup && <div style={styles.codeLine}>Invite code: <b>{currentGroup.join_code}</b></div>}

        {groupId ? (
          <>
            <div style={styles.addRow}>
              <input style={styles.input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExpense()} placeholder="Add an expense" />
              <button style={styles.addBtn} onClick={addExpense}>+</button>
            </div>
            <div style={styles.list}>
              {expenses.length === 0 && <div style={styles.empty}>No expenses in this group yet.</div>}
              {expenses.map((e) => (
                <div key={e.id} style={styles.item}>
                  <div style={styles.itemEmoji}>{e.emoji || '🧾'}</div>
                  <div style={styles.itemMain}>
                    <div style={styles.itemName}>{e.name}</div>
                    <div style={styles.itemPaid}>paid by {e.paid_by}</div>
                    
                    {e.people && e.people.length > 0 && (
                      <div style={styles.itemSplit}>
                        Split with: {e.people.join(', ')} ({inr(e.each)} each)
                      </div>
                    )}
                  </div>
                  <div style={styles.itemAmount}>{inr(e.amount)}</div>
                  <button style={styles.remove} onClick={() => removeExpense(e.id)}>×</button>
                </div>
              ))}
            </div>
            <div style={styles.total}>Total {inr(total)}</div>
          </>
        ) : (
          <div style={styles.empty}>Create a group or join one with a code to get started.</div>
        )}
      </div>
      {groupDialog && (
        <div style={styles.dialogBackdrop}>
          <form
            style={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-dialog-title"
            onSubmit={submitGroupDialog}
          >
            <h2 id="group-dialog-title" style={styles.dialogTitle}>
              {groupDialog === 'create' ? 'Create a group' : 'Join a group'}
            </h2>
            <label htmlFor="group-input" style={styles.dialogLabel}>
              {groupDialog === 'create' ? 'Group name' : 'Invite code'}
            </label>
            <input
              id="group-input"
              style={styles.input2}
              value={groupInput}
              onChange={(event) => setGroupInput(event.target.value)}
              placeholder={groupDialog === 'create' ? 'e.g. Goa Trip' : 'Enter the group code'}
              autoFocus
              required
            />
            {groupError && <p role="alert" style={styles.dialogError}>{groupError}</p>}
            <div style={styles.dialogActions}>
              <button type="button" style={styles.authBtnAlt} onClick={closeGroupDialog} disabled={savingGroup}>
                Cancel
              </button>
              <button type="submit" style={styles.authBtn} disabled={savingGroup}>
                {savingGroup ? 'Please wait…' : groupDialog === 'create' ? 'Create group' : 'Join group'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px 48px' },
  card: { width: '100%', maxWidth: 420, background: 'var(--card)', borderRadius: 24, boxShadow: '0 24px 60px -24px rgba(13,27,62,.28)', border: '1px solid var(--line)', padding: 20, marginTop: 12 },
  dialogBackdrop: { position: 'fixed', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(13,27,62,.4)' },
  dialog: { width: '100%', maxWidth: 380, padding: 22, borderRadius: 20, background: 'var(--card)', boxShadow: '0 24px 60px -24px rgba(13,27,62,.4)', border: '1px solid var(--line)' },
  dialogTitle: { margin: '0 0 16px', fontSize: 20 },
  dialogLabel: { display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--muted)' },
  dialogError: { margin: '0 0 12px', color: '#b42318', fontSize: 13 },
  dialogActions: { display: 'flex', gap: 10, marginTop: 8 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 18, background: 'linear-gradient(135deg, var(--blue), var(--cyan))' },
  title: { fontSize: 20, fontWeight: 800 },
  signout: { border: '1px solid var(--line)', background: '#fff', borderRadius: 10, padding: '7px 13px', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' },
  groupBar: { display: 'flex', gap: 8, marginBottom: 8 },
  select: { flex: 1, border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', fontSize: 14, fontWeight: 700, background: '#f7f9fc', color: 'var(--ink)' },
  gbtn: { flex: 'none', border: '1px solid var(--line)', background: '#fff', borderRadius: 12, padding: '0 14px', fontSize: 13.5, fontWeight: 800, color: 'var(--blue)', cursor: 'pointer' },
  codeLine: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 },
  addRow: { display: 'flex', gap: 10, marginBottom: 16 },
  input: { flex: 1, border: '1px solid var(--line)', borderRadius: 14, padding: '13px 15px', fontSize: 15, outline: 'none', background: '#f7f9fc' },
  input2: { width: '100%', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', fontSize: 15, outline: 'none', background: '#f7f9fc', marginBottom: 10, boxSizing: 'border-box' },
  authBtn: { flex: 1, border: 'none', borderRadius: 12, padding: '12px', color: '#fff', fontSize: 15, fontWeight: 800, background: 'linear-gradient(135deg, var(--blue), var(--cyan))', cursor: 'pointer' },
  authBtnAlt: { flex: 1, border: '1px solid var(--line)', borderRadius: 12, padding: '12px', color: 'var(--ink)', fontSize: 15, fontWeight: 800, background: '#fff', cursor: 'pointer' },
  addBtn: { flex: 'none', width: 48, borderRadius: 14, border: 'none', color: '#fff', fontSize: 24, fontWeight: 700, background: 'linear-gradient(135deg, var(--blue), var(--cyan))', cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 },
  empty: { color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' },
  item: { display: 'flex', alignItems: 'center', gap: 12, background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px' },
  itemEmoji: { width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid var(--line)', fontSize: 19, flex: 'none' },
  itemMain: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: 700, fontSize: 15 },
  itemPaid: { color: 'var(--muted)', fontSize: 12.5, marginTop: 1 },
  itemSplit: { color: 'var(--blue, #1C5FD4)', fontSize: 12, fontWeight: 600, marginTop: 3 },
  itemAmount: { fontWeight: 800, fontSize: 15.5 },
  remove: { flex: 'none', width: 26, height: 26, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' },
  total: { textAlign: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)', fontWeight: 800, fontSize: 16 },
};