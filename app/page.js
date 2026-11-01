'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

const mergeChatMessages = (current, incoming) => {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-100);
};

export default function Home() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [inviteCodeMessage, setInviteCodeMessage] = useState('');
  const [inviteCodeCopied, setInviteCodeCopied] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [expenseLoadError, setExpenseLoadError] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatConnectionStatus, setChatConnectionStatus] = useState('offline');
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [groupDialog, setGroupDialog] = useState(null);
  const [groupInput, setGroupInput] = useState('');
  const [groupError, setGroupError] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [removingGroupId, setRemovingGroupId] = useState('');
  const [groupToRemove, setGroupToRemove] = useState(null);
  const [groupRemoveError, setGroupRemoveError] = useState('');
  const groupPickerRef = useRef(null);
  const groupTriggerRef = useRef(null);
  const groupOptionRefs = useRef([]);
  const addingExpenseRef = useRef(false);
  const chatMessagesRef = useRef(null);
  const activeChatGroupIdRef = useRef('');

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
    let active = true;
    if (!session || !groupId) {
      setExpenses([]);
      setLoadingExpenses(false);
      setExpenseLoadError('');
      return () => { active = false; };
    }

    setLoadingExpenses(true);
    setExpenseLoadError('');
    const loadExpenses = async () => {
      try {
        const { data, error } = await supabase.from('expenses').select('*').eq('group_id', groupId).order('created_at');
        if (error) throw error;
        const formatted = (data || []).map((e) => ({
          ...e,
          people: e.people && e.people.length > 0 ? e.people : ['You'],
          each: e.each || (e.amount / (e.people?.length || 1))
        }));
        if (active) setExpenses(formatted);
      } catch (error) {
        if (active) {
          setExpenses([]);
          setExpenseLoadError(error.message || 'Could not load expenses. Please try again.');
        }
      } finally {
        if (active) setLoadingExpenses(false);
      }
    };
    loadExpenses();
    return () => { active = false; };
  }, [session, groupId]);

  useEffect(() => {
    let active = true;
    activeChatGroupIdRef.current = groupId;
    setChatMessages([]);
    setChatDraft('');
    setChatError('');

    if (!session || !groupId) {
      setLoadingChat(false);
      setChatConnectionStatus('offline');
      return () => { active = false; };
    }

    setLoadingChat(true);
    setChatConnectionStatus('connecting');
    const channel = supabase
      .channel(`group-chat:${groupId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${groupId}`
      }, ({ new: message }) => {
        if (active) {
          setChatMessages((messages) => mergeChatMessages(messages, [message]));
        }
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          setChatConnectionStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setChatConnectionStatus('offline');
          setChatError('Live chat connection failed. Check the group chat database setup and try again.');
        }
      });

    const loadMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('group_messages')
          .select('id, group_id, user_id, message, created_at')
          .eq('group_id', groupId)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        if (active) setChatMessages((messages) => mergeChatMessages(messages, (data || []).reverse()));
      } catch (error) {
        if (active) setChatError(error.message || 'Could not load group messages.');
      } finally {
        if (active) setLoadingChat(false);
      }
    };

    loadMessages();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [session, groupId]);

  useEffect(() => {
    const messageList = chatMessagesRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    if (!groupMenuOpen) return;

    const closeOnOutsideClick = (event) => {
      if (!groupPickerRef.current?.contains(event.target)) setGroupMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    groupOptionRefs.current[groups.findIndex((group) => group.id === groupId)]?.focus();
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [groupMenuOpen, groupId, groups]);

  const signUp = async () => { setAuthMsg(''); const { error } = await supabase.auth.signUp({ email, password }); setAuthMsg(error ? error.message : 'Account created — you are signed in!'); };
  const signIn = async () => { setAuthMsg(''); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setAuthMsg(error.message); };
  const signOut = async () => {
    setSigningOut(true);
    setSignOutError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setConfirmSignOut(false);
    } catch (error) {
      setSignOutError(error?.message || 'Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  const sendChatMessage = async (event) => {
    event.preventDefault();
    const message = chatDraft.trim();
    if (!message || !groupId || sendingChat) return;

    setSendingChat(true);
    setChatError('');
    try {
      const { data, error } = await supabase
        .from('group_messages')
        .insert({ group_id: groupId, user_id: session.user.id, message })
        .select('id, group_id, user_id, message, created_at')
        .single();
      if (error) throw error;
      if (activeChatGroupIdRef.current === groupId) {
        setChatMessages((messages) => mergeChatMessages(messages, [data]));
        setChatDraft('');
      }
    } catch (error) {
      if (activeChatGroupIdRef.current === groupId) {
        setChatError(error.message || 'Could not send your message.');
      }
    } finally {
      setSendingChat(false);
    }
  };

  const copyInviteCode = async () => {
    if (!currentGroup?.join_code) return;

    setInviteCodeMessage('');
    setInviteCodeCopied(false);
    try {
      await navigator.clipboard.writeText(currentGroup.join_code);
      setInviteCodeCopied(true);
      setInviteCodeMessage('Invite code copied.');
    } catch (error) {
      setInviteCodeMessage(error?.message || 'Could not copy the invite code.');
    }
  };

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

  const removeGroup = async (group) => {
    setRemovingGroupId(group.id);
    setGroupRemoveError('');
    try {
      const { data, error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', session.user.id)
        .select('group_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Could not remove this group from your list.');

      const remainingGroups = groups.filter((item) => item.id !== group.id);
      setGroups(remainingGroups);
      setGroupId((currentId) => currentId === group.id ? remainingGroups[0]?.id || '' : currentId);
      setGroupMenuOpen(false);
      setGroupToRemove(null);
      groupTriggerRef.current?.focus();
    } catch (error) {
      setGroupRemoveError(error.message || 'Could not remove this group. Please try again.');
    } finally {
      setRemovingGroupId('');
    }
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

  const handleGroupPickerKeyDown = (event, index = -1) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setGroupMenuOpen(false);
      groupTriggerRef.current?.focus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setGroupMenuOpen(true);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? groups.length - 1
          : index < 0
            ? groups.findIndex((group) => group.id === groupId)
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + groups.length) % groups.length;
      if (groups.length) groupOptionRefs.current[nextIndex]?.focus();
    }
  };

  const addExpense = async () => {
    const t = text.trim();
    if (!t || !groupId || loadingExpenses || addingExpenseRef.current) return;
    addingExpenseRef.current = true;
    setAddingExpense(true);
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
    finally {
      addingExpenseRef.current = false;
      setAddingExpense(false);
    }
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
          <div style={styles.header}><div style={styles.brand}><div style={styles.logo}>UM</div><div style={styles.title}>Udhaar Manager</div></div></div>
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
          <div style={styles.brand}><div style={styles.logo}>UM</div><div style={styles.title}>Udhaar Manager</div></div>
          <button
            style={styles.signout}
            onClick={() => {
              setSignOutError('');
              setConfirmSignOut(true);
            }}
          >
            Sign out
          </button>
        </div>

        <div style={styles.groupBar}>
          <div className="group-picker" ref={groupPickerRef}>
            <button
              ref={groupTriggerRef}
              type="button"
              className="group-picker-trigger"
              aria-haspopup="menu"
              aria-expanded={groupMenuOpen}
              aria-label={`Current group: ${currentGroup?.name || 'No groups yet'}`}
              onClick={() => setGroupMenuOpen((open) => !open)}
              onKeyDown={(event) => handleGroupPickerKeyDown(event)}
            >
              <span className="group-picker-name">{currentGroup?.name || 'No groups yet'}</span>
              <span className="group-picker-chevron" aria-hidden="true" />
            </button>
            {groupMenuOpen && (
              <div className="group-picker-menu" role="menu" aria-label="Choose a group">
                {groups.length === 0 ? (
                  <div className="group-picker-empty">No groups yet</div>
                ) : groups.map((group, index) => (
                  <div key={group.id} className={`group-picker-row${group.id === groupId ? ' is-selected' : ''}`}>
                    <button
                      ref={(element) => { groupOptionRefs.current[index] = element; }}
                      type="button"
                      className="group-picker-option"
                      role="menuitemradio"
                      aria-checked={group.id === groupId}
                      onClick={() => {
                        setGroupId(group.id);
                        setGroupMenuOpen(false);
                        groupTriggerRef.current?.focus();
                      }}
                      onKeyDown={(event) => handleGroupPickerKeyDown(event, index)}
                    >
                      <span className="group-picker-option-name">{group.name}</span>
                    </button>
                    <button
                      type="button"
                      className="group-picker-remove"
                      role="menuitem"
                      aria-label={`Remove ${group.name} from your group list`}
                      title="Remove from your list"
                      disabled={Boolean(removingGroupId)}
                      onClick={() => {
                        setGroupRemoveError('');
                        setGroupMenuOpen(false);
                        setGroupToRemove(group);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button style={styles.gbtn} onClick={() => openGroupDialog('create')}>+ New</button>
          <button style={styles.gbtn} onClick={() => openGroupDialog('join')}>Join</button>
        </div>
        {currentGroup && (
          <div style={styles.codeLine}>
            <span className="invite-code-label">Invite code:</span>{' '}
            <b className="invite-code-value">{currentGroup.join_code}</b>
            <button
              type="button"
              className="invite-code-copy"
              onClick={copyInviteCode}
              aria-label={inviteCodeCopied ? 'Invite code copied' : 'Copy invite code'}
              title={inviteCodeCopied ? 'Copied!' : 'Copy invite code'}
            >
              {inviteCodeCopied ? (
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m4 10 4 4 8-8" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="7" y="6" width="9" height="11" rx="1.5" />
                  <path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H7" />
                </svg>
              )}
            </button>
            <span className="invite-code-status" aria-live="polite">{inviteCodeMessage}</span>
          </div>
        )}

        {groupId ? (
          <>
            <div className="expense-entry-bar" style={styles.addRow}>
              <input
                style={styles.input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExpense()}
                placeholder="Add an expense"
                disabled={addingExpense}
                aria-busy={addingExpense || loadingExpenses}
              />
              <button
                style={styles.addBtn}
                className="expense-add-button"
                onClick={addExpense}
                disabled={addingExpense || loadingExpenses}
                aria-label={addingExpense ? 'Adding expense' : loadingExpenses ? 'Loading expenses' : 'Add expense'}
                title={addingExpense ? 'AI is thinking…' : loadingExpenses ? 'Loading expenses…' : 'Add expense'}
              >
                {addingExpense || loadingExpenses
                  ? <span className="expense-spinner" aria-hidden="true" />
                  : '+'}
              </button>
            </div>
            <div style={styles.list}>
              {loadingExpenses && <div className="expense-loading" role="status"><span className="expense-spinner" aria-hidden="true" />Loading expenses…</div>}
              {expenseLoadError && <div role="alert" style={styles.dialogError}>{expenseLoadError}</div>}
              {!loadingExpenses && !expenseLoadError && expenses.length === 0 && <div style={styles.empty}>No expenses in this group yet.</div>}
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
      <section className="chat-card" aria-label="Group chat">
        <header className="chat-header">
          <div>
            <h2 className="chat-title">Group chat</h2>
            <p className="chat-subtitle">{currentGroup ? currentGroup.name : 'Join or create a group to chat'}</p>
          </div>
          {groupId && (
            <span className={`chat-live-indicator${chatConnectionStatus === 'offline' ? ' is-offline' : ''}`}>
              <span aria-hidden="true" />
              {chatConnectionStatus === 'connected' ? 'Live' : chatConnectionStatus === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
          )}
        </header>
        {groupId ? (
          <>
            <div className="chat-messages" ref={chatMessagesRef} aria-live="polite" aria-relevant="additions">
              {loadingChat && chatMessages.length === 0 && <p className="chat-empty">Loading messages…</p>}
              {!loadingChat && !chatError && chatMessages.length === 0 && <p className="chat-empty">No messages yet. Say hello to your group!</p>}
              {chatMessages.map((message) => {
                const ownMessage = message.user_id === session.user.id;
                return (
                  <article key={message.id} className={`chat-message${ownMessage ? ' is-own' : ''}`}>
                    <div className="chat-message-meta">
                      <span>{ownMessage ? 'You' : `Member ${message.user_id.slice(0, 6)}`}</span>
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </time>
                    </div>
                    <p>{message.message}</p>
                  </article>
                );
              })}
            </div>
            {chatError && <p className="chat-error" role="alert">{chatError}</p>}
            <form className="chat-compose" onSubmit={sendChatMessage}>
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                placeholder="Write a message…"
                aria-label="Chat message"
                maxLength={1000}
                disabled={sendingChat}
              />
              <button type="submit" disabled={sendingChat || !chatDraft.trim()} aria-label="Send message">
                {sendingChat ? '…' : 'Send'}
              </button>
            </form>
          </>
        ) : (
          <p className="chat-empty">Create a group or join one to start chatting with its members.</p>
        )}
      </section>
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
      {confirmSignOut && (
        <div style={styles.dialogBackdrop}>
          <div
            style={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="signout-dialog-title"
          >
            <h2 id="signout-dialog-title" style={styles.dialogTitle}>
              Are you sure you want to sign out of this account?
            </h2>
            {signOutError && <p role="alert" style={styles.dialogError}>{signOutError}</p>}
            <div style={styles.dialogActions}>
              <button
                type="button"
                style={styles.authBtn}
                onClick={signOut}
                disabled={signingOut}
              >
                {signingOut ? 'Please wait…' : 'Yes'}
              </button>
              <button
                type="button"
                style={styles.authBtnAlt}
                onClick={() => setConfirmSignOut(false)}
                disabled={signingOut}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {groupToRemove && (
        <div style={styles.dialogBackdrop}>
          <div
            style={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-group-dialog-title"
          >
            <h2 id="remove-group-dialog-title" style={styles.dialogTitle}>
              Are you sure you want to delete this group?
            </h2>
            {groupRemoveError && <p role="alert" style={styles.dialogError}>{groupRemoveError}</p>}
            <div style={styles.dialogActions}>
              <button
                type="button"
                style={styles.authBtn}
                onClick={() => removeGroup(groupToRemove)}
                disabled={Boolean(removingGroupId)}
              >
                {removingGroupId ? 'Please wait…' : 'Yes'}
              </button>
              <button
                type="button"
                style={styles.authBtnAlt}
                onClick={() => {
                  setGroupToRemove(null);
                  setGroupRemoveError('');
                }}
                disabled={Boolean(removingGroupId)}
              >
                Cancel
              </button>
            </div>
          </div>
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
  logo: { width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', paddingRight: 4, color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: '-5px', background: 'linear-gradient(135deg, var(--blue), var(--cyan))' },
  title: { fontSize: 20, fontWeight: 800 },
  signout: { border: '1px solid #fecdca', background: '#fef3f2', borderRadius: 10, padding: '7px 13px', fontSize: 13, fontWeight: 700, color: '#b42318', cursor: 'pointer' },
  groupBar: { display: 'flex', gap: 8, marginBottom: 8 },
  gbtn: { flex: 'none', border: '1px solid var(--line)', background: '#fff', borderRadius: 12, padding: '0 14px', fontSize: 13.5, fontWeight: 800, color: 'var(--blue)', cursor: 'pointer' },
  codeLine: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 14, paddingLeft: 12 },
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