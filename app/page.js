'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

const distributeCents = (total, weights) => {
  const totalCents = Math.round(Number(total) * 100);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!weights.length || weightTotal <= 0) return [];

  const exactShares = weights.map((weight) => totalCents * weight / weightTotal);
  const shares = exactShares.map(Math.floor);
  let remainingCents = totalCents - shares.reduce((sum, share) => sum + share, 0);
  const remainderOrder = exactShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let index = 0; remainingCents > 0; index += 1, remainingCents -= 1) {
    shares[remainderOrder[index % remainderOrder.length].index] += 1;
  }

  return shares;
};

const getSplitParticipants = (members, names, currentUserId) => {
  const participants = [];
  const seenIds = new Set();
  const seenNames = new Set();
  const currentUser = members.find((member) => member.user_id === currentUserId);

  const addParticipant = (rawName, userId = null) => {
    const name = String(rawName || '').trim();
    if (!name) return;
    const member = (userId && members.find((item) => item.user_id === userId))
      || (name.toLocaleLowerCase() === 'you'
        ? currentUser
        : members.find((item) => item.username.toLocaleLowerCase() === name.toLocaleLowerCase()));
    const participantName = member?.username || (name.toLocaleLowerCase() === 'you' && currentUser ? currentUser.username : name);
    const key = member ? `member:${member.user_id}` : `person:${participantName.toLocaleLowerCase()}`;
    if (seenIds.has(key) || seenNames.has(participantName.toLocaleLowerCase())) return;
    seenIds.add(key);
    seenNames.add(participantName.toLocaleLowerCase());
    participants.push({ key, name: participantName, user_id: member?.user_id || null });
  };

  members.forEach((member) => addParticipant(member.username, member.user_id));
  names.forEach((name) => addParticipant(name));
  return participants;
};

const mergeChatMessages = (current, incoming) => {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-100);
};

const getExpenseDebts = (expense, members, payer, currentUserId) => {
  const payerName = payer?.name || payer?.username || expense.paid_by;
  const payerId = payer?.user_id || expense.paid_by_user_id;
  const debtShares = Array.isArray(expense.shares) && expense.shares.length
    ? expense.shares
    : (expense.people || []).map((name) => ({ name, amount: expense.each || 0 }));

  return debtShares
    .map((share) => {
      const participantName = String(share.name || '');
      const member = share.user_id
        ? members.find((item) => item.user_id === share.user_id)
        : participantName.toLocaleLowerCase() === 'you'
          ? members.find((item) => item.user_id === currentUserId)
          : members.find((item) => item.username.toLocaleLowerCase() === participantName.toLocaleLowerCase());
      const name = member?.username || (participantName.toLocaleLowerCase() === 'you' ? 'You' : participantName);
      const owesPayer = (member && payerId && member.user_id === payerId)
        || name.toLocaleLowerCase() === String(payerName).toLocaleLowerCase();

      return owesPayer ? null : {
        name,
        userId: member?.user_id || null,
        amount: Number(share.amount || 0),
        payerName,
        payerId
      };
    })
    .filter(Boolean);
};

const getExpensePayerOptions = (expense, members, currentUserId) => {
  const options = members.map((member) => ({
    value: `member:${member.user_id}`,
    name: member.username,
    user_id: member.user_id
  }));
  const knownNames = new Set(members.map((member) => member.username.toLocaleLowerCase()));
  const currentUser = members.find((member) => member.user_id === currentUserId);

  [...(expense.people || []), expense.paid_by]
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .forEach((name) => {
      const normalizedName = name.toLocaleLowerCase();
      const member = normalizedName === 'you'
        ? currentUser
        : members.find((item) => item.username.toLocaleLowerCase() === normalizedName);
      if (member) {
        knownNames.add(member.username.toLocaleLowerCase());
        return;
      }
      if (knownNames.has(normalizedName)) return;

      knownNames.add(normalizedName);
      options.push({ value: `person:${normalizedName}`, name });
    });

  return options;
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
  const [loadedExpensesGroupId, setLoadedExpensesGroupId] = useState('');
  const [addingExpense, setAddingExpense] = useState(false);
  const [expenseLoadError, setExpenseLoadError] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [loadingGroupMembers, setLoadingGroupMembers] = useState(false);
  const [loadedGroupMembersId, setLoadedGroupMembersId] = useState('');
  const [groupMembersError, setGroupMembersError] = useState('');
  const [updatingPayerId, setUpdatingPayerId] = useState('');
  const [expensePayerError, setExpensePayerError] = useState('');
  const [openPayerExpenseId, setOpenPayerExpenseId] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState('');
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [clearChatError, setClearChatError] = useState('');
  const [chatProfiles, setChatProfiles] = useState({});
  const [debtReminders, setDebtReminders] = useState([]);
  const [paymentNotifications, setPaymentNotifications] = useState([]);
  const [payingReminderId, setPayingReminderId] = useState('');
  const [debtReminderError, setDebtReminderError] = useState('');
  const [profileSaveError, setProfileSaveError] = useState('');
  const [chatConnectionStatus, setChatConnectionStatus] = useState('offline');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const markingPaymentNotificationsReadRef = useRef(false);
  const [text, setText] = useState('');
  const [splitMode, setSplitMode] = useState('equal');
  const [customUnit, setCustomUnit] = useState('amount');
  const [pendingCustomExpense, setPendingCustomExpense] = useState(null);
  const [customShareValues, setCustomShareValues] = useState({});
  const [expenseFormError, setExpenseFormError] = useState('');
  const [username, setUsername] = useState('');
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
  const [groupActionMenuId, setGroupActionMenuId] = useState('');
  const [groupActionMenuPosition, setGroupActionMenuPosition] = useState(null);
  const [groupForMembers, setGroupForMembers] = useState(null);
  const [membersDialogData, setMembersDialogData] = useState([]);
  const [loadingMembersDialog, setLoadingMembersDialog] = useState(false);
  const [membersDialogError, setMembersDialogError] = useState('');
  const [groupToEdit, setGroupToEdit] = useState(null);
  const [groupEditName, setGroupEditName] = useState('');
  const [groupEditError, setGroupEditError] = useState('');
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);
  const groupPickerRef = useRef(null);
  const groupTriggerRef = useRef(null);
  const groupOptionRefs = useRef([]);
  const groupActionMenuRefs = useRef({});
  const groupActionMenuRef = useRef(null);
  const addingExpenseRef = useRef(false);
  const chatMessagesRef = useRef(null);
  const customSplitRef = useRef(null);

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
    setGroupMembers([]);
    setGroupMembersError('');

    if (!session || !groupId) {
      setLoadingGroupMembers(false);
      setLoadedGroupMembersId('');
      return () => { active = false; };
    }

    setLoadingGroupMembers(true);
    setLoadedGroupMembersId('');
    const loadGroupMembers = async () => {
      try {
        const { data, error } = await supabase.rpc('get_group_members', { gid: groupId });
        if (error) throw error;
        if (active) {
          setGroupMembers(data || []);
          setLoadedGroupMembersId(groupId);
        }
      } catch (error) {
        if (active) setGroupMembersError(error.message || 'Could not load group members.');
      } finally {
        if (active) setLoadingGroupMembers(false);
      }
    };

    loadGroupMembers();
    return () => { active = false; };
  }, [session, groupId]);

  useEffect(() => {
    let active = true;
    if (!session || !groupId) {
      setExpenses([]);
      setLoadingExpenses(false);
      setLoadedExpensesGroupId('');
      setExpenseLoadError('');
      return () => { active = false; };
    }

    setLoadingExpenses(true);
    setLoadedExpensesGroupId('');
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
        if (active) {
          setExpenses(formatted);
          setLoadedExpensesGroupId(groupId);
        }
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
    setChatMessages([]);
    setDebtReminders([]);
    setPaymentNotifications([]);
    setChatProfiles({});
    setChatError('');
    setDebtReminderError('');

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
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'group_messages'
      }, async () => {
        try {
          const { data, error } = await supabase
            .from('group_messages')
            .select('id, group_id, user_id, message, created_at')
            .eq('group_id', groupId)
            .order('created_at', { ascending: false })
            .limit(100);
          if (error) throw error;
          if (active) setChatMessages((data || []).reverse());
        } catch (error) {
          if (active) setChatError(error.message || 'Could not refresh group notifications.');
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'group_profiles'
      }, ({ new: profile }) => {
        if (active && profile?.user_id && profile?.username) {
          setChatProfiles((profiles) => ({ ...profiles, [profile.user_id]: profile.username }));
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'debt_reminders',
        filter: `group_id=eq.${groupId}`
      }, async () => {
        try {
          const { data, error } = await supabase
            .from('debt_reminders')
            .select('id, group_id, payer_name, payer_user_id, amount_cents, paid_at, updated_at')
            .eq('group_id', groupId)
            .eq('debtor_user_id', session.user.id)
            .gt('amount_cents', 0)
            .order('updated_at', { ascending: false });
          if (error) throw error;
          if (active) setDebtReminders(data || []);
        } catch (error) {
          if (active) setDebtReminderError(error.message || 'Could not refresh payment reminders.');
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'payment_notifications',
        filter: `group_id=eq.${groupId}`
      }, async () => {
        try {
          const { data, error } = await supabase
            .from('payment_notifications')
            .select('id, group_id, debtor_name, amount_cents, notification_type, payer_name, read_at, created_at')
            .eq('group_id', groupId)
            .eq('recipient_user_id', session.user.id)
            .order('created_at', { ascending: false });
          if (error) throw error;
          if (active) setPaymentNotifications(data || []);
        } catch (error) {
          if (active) setDebtReminderError(error.message || 'Could not refresh payment notifications.');
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
        const [messageResult, profileResult, reminderResult, paymentResult] = await Promise.all([
          supabase
            .from('group_messages')
            .select('id, group_id, user_id, message, created_at')
            .eq('group_id', groupId)
            .order('created_at', { ascending: false })
            .limit(100),
          supabase.from('group_profiles').select('user_id, username'),
          supabase
            .from('debt_reminders')
            .select('id, group_id, payer_name, payer_user_id, amount_cents, paid_at, updated_at')
            .eq('group_id', groupId)
            .eq('debtor_user_id', session.user.id)
            .gt('amount_cents', 0)
            .order('updated_at', { ascending: false }),
          supabase
            .from('payment_notifications')
            .select('id, group_id, debtor_name, amount_cents, notification_type, payer_name, read_at, created_at')
            .eq('group_id', groupId)
            .eq('recipient_user_id', session.user.id)
            .order('created_at', { ascending: false })
        ]);
        if (messageResult.error) throw messageResult.error;
        if (profileResult.error) throw profileResult.error;
        if (reminderResult.error) throw reminderResult.error;
        if (paymentResult.error) throw paymentResult.error;
        if (active) {
          setChatMessages((messages) => mergeChatMessages(messages, (messageResult.data || []).reverse()));
          setChatProfiles(Object.fromEntries((profileResult.data || []).map((profile) => [profile.user_id, profile.username])));
          setDebtReminders(reminderResult.data || []);
          setPaymentNotifications(paymentResult.data || []);
        }
      } catch (error) {
        if (active) {
          setChatError(error.message || 'Could not load group messages.');
          setDebtReminderError(error.message || 'Could not load payment reminders.');
        }
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
  }, [chatMessages, debtReminders]);

  useEffect(() => {
    if (pendingCustomExpense) customSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [pendingCustomExpense]);

  useEffect(() => {
    if (!groupMenuOpen) return;

    const closeOnOutsideClick = (event) => {
      if (!groupPickerRef.current?.contains(event.target)) setGroupMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    groupOptionRefs.current[groups.findIndex((group) => group.id === groupId)]?.focus();
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [groupMenuOpen, groupId, groups]);

  useEffect(() => {
    if (!groupActionMenuId) return;

    const closeMenu = () => {
      setGroupActionMenuId('');
      setGroupActionMenuPosition(null);
    };
    const closeOnOutsideClick = (event) => {
      if (
        !groupActionMenuRefs.current[groupActionMenuId]?.contains(event.target)
        && !groupActionMenuRef.current?.contains(event.target)
      ) closeMenu();
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        groupActionMenuRefs.current[groupActionMenuId]?.focus();
      }
    };
    const closeOnViewportChange = () => closeMenu();
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [groupActionMenuId]);

  useEffect(() => {
    if (!openPayerExpenseId) return;

    const closeOnOutsideClick = (event) => {
      if (!event.target.closest('.payer-picker')) setOpenPayerExpenseId('');
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenPayerExpenseId('');
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openPayerExpenseId]);

  const saveUsername = async (userId, value) => {
    const { error } = await supabase.from('group_profiles').upsert({ user_id: userId, username: value });
    if (error) throw error;
    setProfileSaveError('');
  };

  const signUp = async () => {
    setAuthMsg('');
    setProfileSaveError('');
    const cleanUsername = username.trim();
    if (!cleanUsername || cleanUsername.length > 40) {
      setAuthMsg('Enter a username between 1 and 40 characters.');
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: cleanUsername } }
    });
    if (error) {
      setAuthMsg(error.message);
    } else if (data.session) {
      try {
        await saveUsername(data.user.id, cleanUsername);
        setAuthMsg('Account created — you are signed in!');
      } catch (saveError) {
        setProfileSaveError(saveError.message || 'Account created, but your username could not be saved.');
      }
    } else {
      setAuthMsg('Account created. Check your email to confirm, then sign in.');
    }
  };

  const signIn = async () => {
    setAuthMsg('');
    setProfileSaveError('');
    const cleanUsername = username.trim();
    if (!cleanUsername || cleanUsername.length > 40) {
      setAuthMsg('Enter a username between 1 and 40 characters.');
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMsg(error.message);
      return;
    }

    try {
      await saveUsername(data.user.id, cleanUsername);
    } catch (saveError) {
      setProfileSaveError(saveError.message || 'Signed in, but your username could not be saved.');
    }
  };
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

  const clearChatMessages = async () => {
    if (!groupId || clearingChat) return;
    setClearingChat(true);
    setClearChatError('');
    try {
      const { error } = await supabase
        .from('group_messages')
        .delete()
        .eq('group_id', groupId);
      if (error) throw error;
      setChatMessages([]);
      setConfirmClearChat(false);
    } catch (error) {
      setClearChatError(error.message || 'Could not clear group notifications.');
    } finally {
      setClearingChat(false);
    }
  };

  const confirmReminderPaid = async (reminder) => {
    if (payingReminderId) return;
    setPayingReminderId(reminder.id);
    setDebtReminderError('');
    try {
      const { data: notificationId, error } = await supabase.rpc('confirm_debt_reminder_paid', {
        reminder_id: reminder.id
      });
      if (error) throw error;
      const markedAt = new Date().toISOString();
      setDebtReminders((current) => current.map((item) => (
        item.id === reminder.id ? { ...item, paid_at: markedAt } : item
      )));
      if (notificationId) {
        setPaymentNotifications((current) => [
          {
            id: notificationId,
            group_id: groupId,
            debtor_name: chatProfiles[session.user.id] || username.trim() || 'You',
            amount_cents: reminder.amount_cents,
            notification_type: 'marked_as_paid',
            payer_name: reminder.payer_name,
            read_at: markedAt,
            created_at: markedAt
          },
          ...current.filter((notification) => notification.id !== notificationId)
        ]);
      }
    } catch (error) {
      setDebtReminderError(error.message || 'Could not notify the payer that you have paid.');
    } finally {
      setPayingReminderId('');
    }
  };

  const markPaymentNotificationsRead = useCallback(async () => {
    if (!groupId || markingPaymentNotificationsReadRef.current) return;
    if (!paymentNotifications.some((notification) => !notification.read_at)) return;

    markingPaymentNotificationsReadRef.current = true;
    setDebtReminderError('');
    const readAt = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from('payment_notifications')
        .update({ read_at: readAt })
        .eq('group_id', groupId)
        .eq('recipient_user_id', session.user.id)
        .is('read_at', null)
        .select('id');
      if (error) throw error;
      const readIds = new Set((data || []).map((notification) => notification.id));
      setPaymentNotifications((current) => current.map((notification) => (
        readIds.has(notification.id) ? { ...notification, read_at: readAt } : notification
      )));
    } catch (error) {
      setDebtReminderError(error.message || 'Could not mark payment notifications as read.');
    } finally {
      markingPaymentNotificationsReadRef.current = false;
    }
  }, [groupId, paymentNotifications, session?.user?.id]);

  useEffect(() => {
    if (notificationsOpen) markPaymentNotificationsRead();
  }, [notificationsOpen, markPaymentNotificationsRead]);

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

  const toggleGroupActionMenu = (groupId, event) => {
    if (groupActionMenuId === groupId) {
      setGroupActionMenuId('');
      setGroupActionMenuPosition(null);
      return;
    }

    const triggerBounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 160;
    const menuHeight = 140;
    const preferredLeft = triggerBounds.right + 8;
    const left = preferredLeft + menuWidth <= window.innerWidth - 8
      ? preferredLeft
      : Math.max(8, triggerBounds.left - menuWidth - 8);
    const top = Math.min(
      Math.max(8, triggerBounds.top - 4),
      Math.max(8, window.innerHeight - menuHeight - 8)
    );
    setGroupActionMenuPosition({ left, top });
    setGroupActionMenuId(groupId);
  };

  const closeGroupActionMenu = () => {
    setGroupActionMenuId('');
    setGroupActionMenuPosition(null);
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

  const openMembersDialog = async (group) => {
    closeGroupActionMenu();
    setGroupForMembers(group);
    setMembersDialogData([]);
    setMembersDialogError('');
    setLoadingMembersDialog(true);
    try {
      const { data, error } = await supabase.rpc('get_group_members', { gid: group.id });
      if (error) throw error;
      setMembersDialogData(data || []);
    } catch (error) {
      setMembersDialogError(error.message || 'Could not load group members.');
    } finally {
      setLoadingMembersDialog(false);
    }
  };

  const openGroupEdit = (group) => {
    closeGroupActionMenu();
    setGroupToEdit(group);
    setGroupEditName(group.name);
    setGroupEditError('');
  };

  const saveGroupEdit = async (event) => {
    event.preventDefault();
    const name = groupEditName.trim();
    if (!name || !groupToEdit || savingGroupEdit) return;

    setSavingGroupEdit(true);
    setGroupEditError('');
    try {
      const { data, error } = await supabase
        .from('groups')
        .update({ name })
        .eq('id', groupToEdit.id)
        .select('id, name, join_code, created_at')
        .single();
      if (error) throw error;
      setGroups((current) => current.map((group) => group.id === data.id ? { ...group, ...data } : group));
      setGroupToEdit(null);
    } catch (error) {
      setGroupEditError(error.message || 'Could not update the group name.');
    } finally {
      setSavingGroupEdit(false);
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

  const currentUserId = session?.user?.id;
  const owedTotals = new Map();
  expenses.forEach((expense) => {
    const payerOptions = getExpensePayerOptions(expense, groupMembers, currentUserId);
    const payer = payerOptions.find((option) => option.user_id === expense.paid_by_user_id)
      || payerOptions.find((option) => option.name.toLocaleLowerCase() === String(expense.paid_by).toLocaleLowerCase())
      || payerOptions[0];
    getExpenseDebts(expense, groupMembers, payer, currentUserId).forEach((debt) => {
      const debtorKey = debt.userId ? `user:${debt.userId}` : `name:${String(debt.name).toLocaleLowerCase()}`;
      const payerKey = debt.payerId ? `user:${debt.payerId}` : `name:${String(debt.payerName).toLocaleLowerCase()}`;
      const key = JSON.stringify([debtorKey, payerKey]);
      const existing = owedTotals.get(key);
      owedTotals.set(key, {
        name: debt.name,
        userId: debt.userId,
        debtorKey,
        payerName: debt.payerName,
        payerId: debt.payerId,
        payerKey,
        amountCents: (existing?.amountCents || 0) + Math.round(debt.amount * 100)
      });
    });
  });
  const settlementsByPair = new Map();
  owedTotals.forEach((debt) => {
    const debtorKey = debt.debtorKey;
    const payerKey = debt.payerKey;
    const [personAKey, personBKey] = [debtorKey, payerKey].sort();
    const pairKey = JSON.stringify([personAKey, personBKey]);
    const pair = settlementsByPair.get(pairKey) || {
      personAKey,
      personBKey,
      personA: debtorKey === personAKey ? debt.name : debt.payerName,
      personB: debtorKey === personBKey ? debt.name : debt.payerName,
      personAUserId: debtorKey === personAKey ? debt.userId : debt.payerId,
      personBUserId: debtorKey === personBKey ? debt.userId : debt.payerId,
      personAOwesB: 0,
      personBOwesA: 0
    };

    if (debtorKey === personAKey) {
      pair.personAOwesB += debt.amountCents;
      pair.personAUserId ||= debt.userId;
      pair.personBUserId ||= debt.payerId;
    } else {
      pair.personBOwesA += debt.amountCents;
      pair.personBUserId ||= debt.userId;
      pair.personAUserId ||= debt.payerId;
    }
    settlementsByPair.set(pairKey, pair);
  });
  const netSettlements = [...settlementsByPair.values()]
    .map((pair) => {
      const difference = pair.personAOwesB - pair.personBOwesA;
      if (difference === 0) return null;
      return difference > 0
        ? {
          debtor: pair.personA,
          debtorUserId: pair.personAUserId,
          payer: pair.personB,
          payerUserId: pair.personBUserId,
          amountCents: difference
        }
        : {
          debtor: pair.personB,
          debtorUserId: pair.personBUserId,
          payer: pair.personA,
          payerUserId: pair.personAUserId,
          amountCents: -difference
        };
    })
    .filter(Boolean);
  const debtReminderSignature = JSON.stringify(netSettlements
    .filter((settlement) => settlement.debtorUserId === currentUserId)
    .map((settlement) => ({
      debtor_user_id: settlement.debtorUserId,
      payer_name: settlement.payer,
      payer_user_id: settlement.payerUserId,
      amount_cents: settlement.amountCents
    })));

  useEffect(() => {
    if (
      !session
      || !groupId
      || loadedExpensesGroupId !== groupId
      || loadedGroupMembersId !== groupId
      || loadingExpenses
      || loadingGroupMembers
      || expenseLoadError
      || groupMembersError
    ) return;

    let active = true;
    const syncDebtReminders = async () => {
      setDebtReminderError('');
      try {
        const { error } = await supabase.rpc('sync_debt_reminders', {
          gid: groupId,
          reminders: JSON.parse(debtReminderSignature)
        });
        if (error) throw error;
      } catch (error) {
        if (active) setDebtReminderError(error.message || 'Could not send payment reminders.');
      }
    };

    syncDebtReminders();
    return () => { active = false; };
  }, [
    session?.user?.id,
    groupId,
    debtReminderSignature,
    loadedExpensesGroupId,
    loadedGroupMembersId,
    loadingExpenses,
    loadingGroupMembers,
    expenseLoadError,
    groupMembersError
  ]);

  const currentGroup = groups.find((g) => g.id === groupId);
  const activeDebtReminderCount = debtReminders.filter((reminder) => !reminder.paid_at).length;
  const unreadPaymentNotificationCount = paymentNotifications.filter((notification) => !notification.read_at).length;
  const actionMenuGroup = groups.find((group) => group.id === groupActionMenuId);

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

  const saveExpense = async (expense, shares) => {
    const eachAmount = expense.amount / expense.participants.length;
    const { data: row, error } = await supabase.from('expenses')
      .insert({
        user_id: session.user.id,
        group_id: groupId,
        name: expense.name,
        paid_by: expense.paid_by,
        paid_by_user_id: expense.paid_by_user_id,
        amount: expense.amount,
        people: expense.participants.map((participant) => participant.name),
        each: eachAmount,
        shares
      })
      .select()
      .single();
    if (error) throw error;

    setExpenses((list) => [...list, row]);
    setText('');
    setPendingCustomExpense(null);
    setCustomShareValues({});
    setExpenseFormError('');
  };

  const addExpense = async () => {
    const t = text.trim();
    if (!t || !groupId || loadingExpenses || loadingGroupMembers || addingExpenseRef.current || pendingCustomExpense) return;
    addingExpenseRef.current = true;
    setAddingExpense(true);
    setExpenseFormError('');
    try {
      if (groupMembersError) throw new Error('Could not load group members. Refresh the page before adding an expense.');

      const res = await fetch('/api/split', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentence: t }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not parse this expense.');

      const parsedAmount = Number(data.amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error('The expense total must be greater than zero.');
      const amount = Math.round(parsedAmount * 100) / 100;
      if (amount <= 0) throw new Error('The expense total must be at least one paise.');

      const requestedPayer = data.paidBy || 'You';
      const mentionedNames = Array.isArray(data.people) ? data.people : [];
      const participants = getSplitParticipants(groupMembers, [...mentionedNames, requestedPayer], session.user.id);
      if (!participants.length) throw new Error('Add at least one group member or person to split this expense.');

      const payerParticipant = participants.find((participant) => (
        participant.name.toLocaleLowerCase() === String(requestedPayer).toLocaleLowerCase()
        || (String(requestedPayer).toLocaleLowerCase() === 'you' && participant.user_id === session.user.id)
      ));
      const expense = {
        name: data.description || t,
        amount,
        participants,
        paid_by: payerParticipant?.name || requestedPayer,
        paid_by_user_id: payerParticipant?.user_id || null
      };

      if (splitMode === 'custom') {
        setPendingCustomExpense(expense);
        setCustomShareValues(Object.fromEntries(participants.map((participant) => [participant.key, ''])));
        return;
      }

      const shares = distributeCents(amount, participants.map(() => 1))
        .map((cents, index) => ({
          name: participants[index].name,
          user_id: participants[index].user_id,
          amount: cents / 100
        }));
      await saveExpense(expense, shares);
    } catch (error) {
      setExpenseFormError(error.message || 'Could not add this expense.');
    }
    finally {
      addingExpenseRef.current = false;
      setAddingExpense(false);
    }
  };

  const saveCustomExpense = async () => {
    if (!pendingCustomExpense || addingExpenseRef.current) return;
    setExpenseFormError('');
    const participants = pendingCustomExpense.participants;
    const rawValues = participants.map((participant) => customShareValues[participant.key] ?? '');
    if (rawValues.some((value) => value.trim() === '')) {
      setExpenseFormError('Enter a share for every person.');
      return;
    }

    const values = rawValues.map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      setExpenseFormError('Shares must be valid non-negative numbers.');
      return;
    }

    const totalCents = Math.round(pendingCustomExpense.amount * 100);
    let shareCents;
    if (customUnit === 'amount') {
      shareCents = values.map((value) => Math.round(value * 100));
      const enteredTotal = shareCents.reduce((sum, value) => sum + value, 0);
      if (enteredTotal !== totalCents) {
        setExpenseFormError(`Shares must add up to ${inr(pendingCustomExpense.amount)}.`);
        return;
      }
    } else {
      const percentageTotal = values.reduce((sum, value) => sum + value, 0);
      if (Math.abs(percentageTotal - 100) > 0.01) {
        setExpenseFormError(`Percentages must add up to 100% (currently ${percentageTotal.toFixed(2)}%).`);
        return;
      }
      shareCents = distributeCents(totalCents, values);
    }

    const shares = participants.map((participant, index) => ({
      name: participant.name,
      user_id: participant.user_id,
      amount: shareCents[index] / 100
    }));

    addingExpenseRef.current = true;
    setAddingExpense(true);
    try {
      await saveExpense(pendingCustomExpense, shares);
    } catch (error) {
      setExpenseFormError(error.message || 'Could not save this expense.');
    } finally {
      addingExpenseRef.current = false;
      setAddingExpense(false);
    }
  };

  const cancelCustomExpense = () => {
    setPendingCustomExpense(null);
    setCustomShareValues({});
    setExpenseFormError('');
  };

  const updateExpensePayer = async (expenseId, selectedPayerValue, payerOptions) => {
    const payer = payerOptions.find((option) => option.value === selectedPayerValue);
    if (!payer || updatingPayerId) return;

    setUpdatingPayerId(expenseId);
    setExpensePayerError('');
    try {
      const { data, error } = await supabase
        .from('expenses')
        .update({ paid_by: payer.name, paid_by_user_id: payer.user_id || null })
        .eq('id', expenseId)
        .eq('group_id', groupId)
        .select()
        .single();
      if (error) throw error;
      setExpenses((current) => current.map((expense) => expense.id === expenseId ? { ...expense, ...data } : expense));
      setOpenPayerExpenseId('');
    } catch (error) {
      setExpensePayerError(error.message || 'Could not update who paid for this expense.');
    } finally {
      setUpdatingPayerId('');
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
          <input
            style={styles.input2}
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            aria-label="Username"
            autoComplete="nickname"
            maxLength={40}
            required
          />
          <input style={styles.input2} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input style={styles.input2} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ characters)" />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button style={styles.authBtn} onClick={signUp}>Sign up</button>
            <button style={styles.authBtnAlt} onClick={signIn}>Sign in</button>
          </div>
          {authMsg && <div style={{ marginTop: 12, fontSize: 13, color: '#1C5FD4' }}>{authMsg}</div>}
          {profileSaveError && <p role="alert" style={styles.dialogError}>{profileSaveError}</p>}
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.brand}><div style={styles.logo}>UM</div><div style={styles.title}>Udhaar Manager</div></div>
          <div className="notification-anchor">
            <button
              type="button"
              className="notification-toggle"
              aria-label={notificationsOpen
                ? 'Close notifications'
                : `Open notifications${activeDebtReminderCount + unreadPaymentNotificationCount > 0
                  ? `, ${activeDebtReminderCount + unreadPaymentNotificationCount} unread payment notifications`
                  : ''}`}
              aria-expanded={notificationsOpen}
              aria-controls="group-notifications"
              onClick={() => setNotificationsOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setNotificationsOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M10 21h4" />
              </svg>
              {activeDebtReminderCount + unreadPaymentNotificationCount > 0 && (
                <span className="notification-badge" aria-hidden="true">
                  {activeDebtReminderCount + unreadPaymentNotificationCount}
                </span>
              )}
            </button>
            <section id="group-notifications" className="chat-card" aria-label="Group notifications" hidden={!notificationsOpen}>
              <header className="chat-header">
                <div>
                  <h2 className="chat-title">Notifications</h2>
                  <p className="chat-subtitle">{currentGroup ? `${currentGroup.name} activity` : 'Join or create a group to see activity'}</p>
                </div>
                {groupId && chatMessages.length > 0 && (
                  <button
                    type="button"
                    className="chat-clear-button"
                    onClick={() => {
                      setClearChatError('');
                      setConfirmClearChat(true);
                    }}
                  >
                    Clear all
                  </button>
                )}
              </header>
              {profileSaveError && <p className="chat-error" role="alert">{profileSaveError}</p>}
              {debtReminderError && <p className="chat-error" role="alert">{debtReminderError}</p>}
              {groupId ? (
                <>
                  <div className="chat-messages" ref={chatMessagesRef} aria-live="polite" aria-relevant="additions">
                    {loadingChat && chatMessages.length === 0 && debtReminders.length === 0 && paymentNotifications.length === 0 && <p className="chat-empty">Loading notifications…</p>}
                    {!loadingChat && !chatError && chatMessages.length === 0 && debtReminders.length === 0 && paymentNotifications.length === 0 && <p className="chat-empty">No notifications yet.</p>}
                    {debtReminders.filter((reminder) => !reminder.paid_at).map((reminder) => (
                      <article
                        key={reminder.id}
                        className="chat-notification debt-reminder-notification"
                      >
                        <span className="chat-notification-avatar" aria-hidden="true">₹</span>
                        <div className="chat-notification-content">
                          <div className="chat-notification-meta">
                            <strong>Payment reminder</strong>
                            <time dateTime={reminder.updated_at}>
                              {new Date(reminder.updated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </time>
                          </div>
                          <p>You owe {inr(reminder.amount_cents / 100)} to {reminder.payer_name}. Please settle this amount.</p>
                          <button
                            type="button"
                            className="paid-reminder-button"
                            onClick={() => confirmReminderPaid(reminder)}
                            disabled={Boolean(payingReminderId)}
                          >
                            {payingReminderId === reminder.id ? 'Sending…' : 'Mark as paid'}
                          </button>
                        </div>
                      </article>
                    ))}
                    {paymentNotifications.map((notification) => (
                      <article key={notification.id} className="chat-notification payment-confirmation-notification">
                        <span className="chat-notification-avatar" aria-hidden="true">✓</span>
                        <div className="chat-notification-content">
                          <div className="chat-notification-meta">
                            <strong>{notification.notification_type === 'marked_as_paid' ? 'Marked as paid' : 'Payment reported'}</strong>
                            <time dateTime={notification.created_at}>
                              {new Date(notification.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </time>
                          </div>
                          <p>
                            {notification.notification_type === 'marked_as_paid'
                              ? `You marked ${inr(notification.amount_cents / 100)} paid to ${notification.payer_name || 'the payer'}.`
                              : `${notification.debtor_name} says they paid you ${inr(notification.amount_cents / 100)}.`}
                          </p>
                        </div>
                      </article>
                    ))}
                    {chatMessages.map((message) => {
                      const ownMessage = message.user_id === session.user.id;
                      const senderName = chatProfiles[message.user_id] || (ownMessage ? username.trim() : 'Group member');
                      return (
                        <article key={message.id} className="chat-notification">
                          <span className="chat-notification-avatar" aria-hidden="true">{senderName.charAt(0).toUpperCase()}</span>
                          <div className="chat-notification-content">
                            <div className="chat-notification-meta">
                              <strong>{senderName}</strong>
                              <time dateTime={message.created_at}>
                                {new Date(message.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </time>
                            </div>
                            <p>{message.message}</p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {chatError && <p className="chat-error" role="alert">{chatError}</p>}
                </>
              ) : (
                <p className="chat-empty">Create a group or join one to start chatting with its members.</p>
              )}
            </section>
          </div>
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
                    <div className="group-actions">
                      <button
                        ref={(element) => { groupActionMenuRefs.current[group.id] = element; }}
                        type="button"
                        className="group-actions-trigger"
                        aria-label={`Actions for ${group.name}`}
                        aria-haspopup="menu"
                        aria-expanded={groupActionMenuId === group.id}
                        onClick={(event) => toggleGroupActionMenu(group.id, event)}
                      >
                        <span /><span /><span />
                      </button>
                    </div>
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
            <div className="expense-split-mode" role="group" aria-label="Expense split type">
              <button
                type="button"
                className={`expense-split-mode-option${splitMode === 'equal' ? ' is-selected' : ''}`}
                aria-pressed={splitMode === 'equal'}
                onClick={() => {
                  setSplitMode('equal');
                  cancelCustomExpense();
                }}
              >
                Equal
              </button>
              <button
                type="button"
                className={`expense-split-mode-option${splitMode === 'custom' ? ' is-selected' : ''}`}
                aria-pressed={splitMode === 'custom'}
                onClick={() => {
                  setSplitMode('custom');
                  cancelCustomExpense();
                }}
              >
                Custom
              </button>
            </div>
            <div className="expense-entry-bar" style={styles.addRow}>
              <input
                style={styles.input}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setExpenseFormError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && !pendingCustomExpense && addExpense()}
                placeholder="Add an expense"
                disabled={addingExpense || Boolean(pendingCustomExpense)}
                aria-busy={addingExpense || loadingExpenses}
              />
              <button
                style={styles.addBtn}
                className="expense-add-button"
                onClick={addExpense}
                disabled={addingExpense || loadingExpenses || loadingGroupMembers || Boolean(groupMembersError) || Boolean(pendingCustomExpense)}
                aria-label={addingExpense ? 'Adding expense' : splitMode === 'custom' ? 'Review custom split' : 'Add expense'}
                title={addingExpense ? 'AI is thinking…' : splitMode === 'custom' ? 'Review custom split' : 'Add expense'}
              >
                {addingExpense || loadingExpenses || loadingGroupMembers
                  ? <span className="expense-spinner" aria-hidden="true" />
                  : splitMode === 'custom' ? '→' : '+'}
              </button>
            </div>
            {splitMode === 'equal' && (
              <p className="expense-split-hint">Split equally among group members and anyone named in the expense.</p>
            )}
            {expenseFormError && <p className="expense-form-error" role="alert">{expenseFormError}</p>}
            {pendingCustomExpense && (
              <section className="custom-split-panel" ref={customSplitRef} aria-labelledby="custom-split-title">
                <header className="custom-split-header">
                  <div>
                    <h3 id="custom-split-title">Custom split</h3>
                    <p>{pendingCustomExpense.name} · Total {inr(pendingCustomExpense.amount)}</p>
                  </div>
                  <button type="button" className="custom-split-cancel" onClick={cancelCustomExpense} disabled={addingExpense}>
                    Cancel
                  </button>
                </header>
                <div className="custom-split-unit" role="group" aria-label="Custom share unit">
                  <button
                    type="button"
                    className={customUnit === 'amount' ? 'is-selected' : ''}
                    aria-pressed={customUnit === 'amount'}
                    onClick={() => {
                      setCustomUnit('amount');
                      setCustomShareValues(Object.fromEntries(pendingCustomExpense.participants.map((person) => [person.key, ''])));
                      setExpenseFormError('');
                    }}
                  >
                    Amount
                  </button>
                  <button
                    type="button"
                    className={customUnit === 'percent' ? 'is-selected' : ''}
                    aria-pressed={customUnit === 'percent'}
                    onClick={() => {
                      setCustomUnit('percent');
                      setCustomShareValues(Object.fromEntries(pendingCustomExpense.participants.map((person) => [person.key, ''])));
                      setExpenseFormError('');
                    }}
                  >
                    Percentage
                  </button>
                </div>
                <div className="custom-share-list">
                  {pendingCustomExpense.participants.map((participant) => (
                    <label className="custom-share-row" key={participant.key}>
                      <span>{participant.name}</span>
                      <span className="custom-share-input-wrap">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={customShareValues[participant.key] ?? ''}
                          onChange={(event) => {
                            setCustomShareValues((values) => ({ ...values, [participant.key]: event.target.value }));
                            setExpenseFormError('');
                          }}
                          aria-label={`${participant.name}'s ${customUnit === 'amount' ? 'share amount' : 'share percentage'}`}
                          placeholder="0"
                          disabled={addingExpense}
                        />
                        <span>{customUnit === 'amount' ? '₹' : '%'}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="custom-split-hint">
                  {customUnit === 'amount'
                    ? `Shares must total ${inr(pendingCustomExpense.amount)}.`
                    : 'Percentages must total 100%; shares are rounded to the nearest paise.'}
                </p>
                <button type="button" className="custom-split-save" onClick={saveCustomExpense} disabled={addingExpense}>
                  {addingExpense ? 'Saving…' : 'Add expense'}
                </button>
              </section>
            )}
            <div style={styles.list}>
              {loadingExpenses && <div className="expense-loading" role="status"><span className="expense-spinner" aria-hidden="true" />Loading expenses…</div>}
              {expenseLoadError && <div role="alert" style={styles.dialogError}>{expenseLoadError}</div>}
              {groupMembersError && <div role="alert" style={styles.dialogError}>{groupMembersError}</div>}
              {expensePayerError && <div role="alert" style={styles.dialogError}>{expensePayerError}</div>}
              {!loadingExpenses && !expenseLoadError && expenses.length === 0 && <div style={styles.empty}>No expenses in this group yet.</div>}
              {expenses.map((e) => {
                const payerOptions = getExpensePayerOptions(e, groupMembers, session.user.id);
                const selectedPayer = payerOptions.find((payer) => payer.user_id === e.paid_by_user_id)
                  || payerOptions.find((payer) => payer.name.toLocaleLowerCase() === String(e.paid_by).toLocaleLowerCase())
                  || payerOptions[0];
                const expenseDebts = getExpenseDebts(e, groupMembers, selectedPayer, session.user.id);
                return (
                <div key={e.id} style={styles.item}>
                  <div style={styles.itemEmoji}>{e.emoji || '🧾'}</div>
                  <div style={styles.itemMain}>
                    <div style={styles.itemName}>{e.name}</div>
                    <div style={styles.itemPaid}>
                      paid by{' '}
                      {payerOptions.length > 0 ? (
                        <span className="payer-picker">
                          <button
                            type="button"
                            className="payer-select"
                            aria-haspopup="listbox"
                            aria-expanded={openPayerExpenseId === e.id}
                            aria-label={`Who paid for ${e.name}? ${selectedPayer?.name || ''}`}
                            onClick={() => setOpenPayerExpenseId((openId) => openId === e.id ? '' : e.id)}
                            disabled={loadingGroupMembers || Boolean(updatingPayerId)}
                          >
                            <span className="payer-select-name">{selectedPayer?.name || 'Select payer'}</span>
                          <span className="payer-chevron" aria-hidden="true" />
                          </button>
                          {openPayerExpenseId === e.id && (
                            <div className="payer-menu" role="listbox" aria-label={`Choose payer for ${e.name}`}>
                              {payerOptions.map((payer) => (
                                <button
                                  key={payer.value}
                                  type="button"
                                  className="payer-option"
                                  role="option"
                                  aria-selected={selectedPayer?.value === payer.value}
                                  onClick={() => updateExpensePayer(e.id, payer.value, payerOptions)}
                                  disabled={Boolean(updatingPayerId)}
                                >
                                  <span>{payer.name}</span>
                                  {selectedPayer?.value === payer.value && <span className="payer-check" aria-hidden="true">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </span>
                      ) : loadingGroupMembers ? 'Loading members…' : e.paid_by}
                    </div>
                    
                    {expenseDebts.length > 0 && (
                      <ul className="expense-debts" aria-label="Who owes whom">
                        {expenseDebts.map((debt, index) => (
                          <li key={`${debt.name}-${index}`}>
                            <strong>{debt.name}</strong> owes {inr(debt.amount)} to <strong>{debt.payerName}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div style={styles.itemAmount}>{inr(e.amount)}</div>
                  <button style={styles.remove} onClick={() => removeExpense(e.id)}>×</button>
                </div>
                );
              })}
            </div>
            <section className="expense-receipt" aria-labelledby="expense-receipt-title">
              <div className="receipt-settlements">
                <h3 id="expense-receipt-title">Total</h3>
                {owedTotals.size > 0 ? (
                  <ul className="receipt-debts">
                    {[...owedTotals.values()].map((debt) => (
                      <li key={`${debt.name}-${debt.payerName}`}>
                        <span>{debt.name} owes {debt.payerName}</span>
                        <strong>{inr(debt.amountCents / 100)}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="receipt-no-debts">No one currently owes another person.</p>
                )}
              </div>
              <div className="receipt-settlements receipt-net-settlements">
                <h3>Net Total</h3>
                {netSettlements.length > 0 ? (
                  <ul className="receipt-debts">
                    {netSettlements.map((settlement) => (
                      <li key={`${settlement.debtor}-${settlement.payer}`}>
                        <span>{settlement.debtor} owes {settlement.payer}</span>
                        <strong>{inr(settlement.amountCents / 100)}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="receipt-no-debts">All debts are settled.</p>
                )}
              </div>
            </section>
          </>
        ) : (
          <div style={styles.empty}>Create a group or join one with a code to get started.</div>
        )}
      </div>
      <footer className="account-actions">
        <button
          type="button"
          className="signout-button"
          onClick={() => {
            setSignOutError('');
            setConfirmSignOut(true);
          }}
        >
          Sign out
        </button>
      </footer>
      {confirmClearChat && (
        <div style={styles.dialogBackdrop}>
          <div
            style={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-chat-dialog-title"
          >
            <h2 id="clear-chat-dialog-title" style={styles.dialogTitle}>Clear all notifications?</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
              This permanently deletes all messages from {currentGroup?.name || 'this group'} for every member.
            </p>
            {clearChatError && <p role="alert" style={styles.dialogError}>{clearChatError}</p>}
            <div style={styles.dialogActions}>
              <button type="button" style={styles.authBtn} onClick={clearChatMessages} disabled={clearingChat}>
                {clearingChat ? 'Clearing…' : 'Clear all'}
              </button>
              <button
                type="button"
                style={styles.authBtnAlt}
                onClick={() => setConfirmClearChat(false)}
                disabled={clearingChat}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
              Remove {groupToRemove.name} from your groups?
            </h2>
            <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
              This removes you from the group. Other members will still have access.
            </p>
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
      {groupForMembers && (
        <div style={styles.dialogBackdrop}>
          <div
            style={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-members-dialog-title"
          >
            <h2 id="group-members-dialog-title" style={styles.dialogTitle}>{groupForMembers.name} members</h2>
            {loadingMembersDialog && <p className="group-members-status">Loading members…</p>}
            {membersDialogError && <p role="alert" style={styles.dialogError}>{membersDialogError}</p>}
            {!loadingMembersDialog && !membersDialogError && membersDialogData.length === 0 && (
              <p className="group-members-status">No members found.</p>
            )}
            {!loadingMembersDialog && membersDialogData.length > 0 && (
              <ul className="group-members-list">
                {membersDialogData.map((member) => (
                  <li key={member.user_id}>{member.username || 'Group member'}</li>
                ))}
              </ul>
            )}
            <div style={styles.dialogActions}>
              <button type="button" style={styles.authBtnAlt} onClick={() => setGroupForMembers(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {groupToEdit && (
        <div style={styles.dialogBackdrop}>
          <form
            style={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-group-dialog-title"
            onSubmit={saveGroupEdit}
          >
            <h2 id="edit-group-dialog-title" style={styles.dialogTitle}>Edit group name</h2>
            <label htmlFor="edit-group-name" style={styles.dialogLabel}>Group name</label>
            <input
              id="edit-group-name"
              style={styles.input2}
              value={groupEditName}
              onChange={(event) => setGroupEditName(event.target.value)}
              maxLength={60}
              autoFocus
              required
            />
            {groupEditError && <p role="alert" style={styles.dialogError}>{groupEditError}</p>}
            <div style={styles.dialogActions}>
              <button
                type="button"
                style={styles.authBtnAlt}
                onClick={() => setGroupToEdit(null)}
                disabled={savingGroupEdit}
              >
                Cancel
              </button>
              <button type="submit" style={styles.authBtn} disabled={savingGroupEdit || !groupEditName.trim()}>
                {savingGroupEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
      {actionMenuGroup && groupActionMenuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={groupActionMenuRef}
          className="group-actions-menu"
          role="menu"
          aria-label={`${actionMenuGroup.name} actions`}
          style={{ left: groupActionMenuPosition.left, top: groupActionMenuPosition.top }}
        >
          <button type="button" role="menuitem" autoFocus onClick={() => openMembersDialog(actionMenuGroup)}>
            Members
          </button>
          <button type="button" role="menuitem" onClick={() => openGroupEdit(actionMenuGroup)}>
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            disabled={Boolean(removingGroupId)}
            onClick={() => {
              setGroupRemoveError('');
              closeGroupActionMenu();
              setGroupMenuOpen(false);
              setGroupToRemove(actionMenuGroup);
            }}
          >
            Delete
          </button>
        </div>,
        document.body
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
  itemAmount: { fontWeight: 800, fontSize: 15.5 },
  remove: { flex: 'none', width: 26, height: 26, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' },
};