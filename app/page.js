'use client';

import { useEffect, useState } from 'react';

// The starter data — the same "My Group" you see in the course slide. You'll replace
// this with a real database in Hour 5. For now it lives in the browser (localStorage).
const SEED = [
  { id: 'seed-1', emoji: '🍽️', name: 'Dinner', paidBy: 'Aisha', amount: 1800 },
  { id: 'seed-2', emoji: '🚕', name: 'Cab', paidBy: 'Raj', amount: 400 },
];

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export default function Home() {
  const [expenses, setExpenses] = useState(SEED);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [openPayerId, setOpenPayerId] = useState(null);

  // Load any saved expenses from the browser on first render.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('splitsmart.expenses');
      if (saved) setExpenses(JSON.parse(saved));
    } catch {}
    setReady(true);
  }, []);

  // Save whenever the list changes.
  useEffect(() => {
    if (ready) {
      try { localStorage.setItem('splitsmart.expenses', JSON.stringify(expenses)); } catch {}
    }
  }, [expenses, ready]);

  useEffect(() => {
    if (!openPayerId) return;
    const menu = document.getElementById(`payer-menu-${openPayerId}`);
    menu?.querySelector('[role="menuitemradio"]')?.focus();
  }, [openPayerId]);

  useEffect(() => {
    if (!openPayerId) return;
    const closeOnOutsideClick = (event) => {
      if (!(event.target instanceof Element)) return;
      const picker = event.target.closest('[data-payer-picker]');
      if (picker?.getAttribute('data-payer-picker') !== openPayerId) {
        setOpenPayerId(null);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick, true);
  }, [openPayerId]);

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const addExpense = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      const res = await fetch('/api/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: t }),
      });
      const data = await res.json();
      if (data.error) { alert('AI error: ' + data.error); return; }
      const people = Array.isArray(data.people) ? data.people : [];

      setExpenses((list) => [...list, {
        id: 'e-' + Date.now(), 
        emoji: '🧾',
        name: data.description || t, 
        paidBy: people.includes('You') ? 'You' : people[0] || 'You',
        amount: data.amount || 0,
        people,
        each: data.each || 0       // Saves amount per person
      }]);
      setText('');
    } catch (e) { alert('Could not reach the AI: ' + e.message); }
  };

  const removeExpense = (id) => setExpenses((list) => list.filter((e) => e.id !== id));
  const updatePayer = (id, paidBy) => setExpenses((list) =>
    list.map((e) => e.id === id ? { ...e, paidBy } : e)
  );

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.brand}>
            <div style={styles.logo}>UM</div>
            <div style={styles.title}>Udhaar Manager</div>
          </div>
          <div style={styles.groupPill}>My Group</div>
        </div>

        {/* Add an expense */}
        <div style={styles.addRow}>
          <input
            style={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addExpense()}
            placeholder="Add an expense…"
            aria-label="Add an expense"
          />
          <button style={styles.addBtn} onClick={addExpense} aria-label="Add">+</button>
        </div>

        {/* Expense list */}
        <div style={styles.list}>
          {expenses.length === 0 && (
            <div style={styles.empty}>No expenses yet — add your first one above.</div>
          )}
          {expenses.map((e) => (
            <div key={e.id} style={styles.item}>
              <div style={styles.itemEmoji}>{e.emoji}</div>
              <div style={styles.itemMain}>
                <div style={styles.itemName}>{e.name}</div>
                <div style={styles.itemPaid}>
                  paid by{' '}
                  {e.people && e.people.length > 0 ? (
                    <span
                      className="payer-picker"
                      data-payer-picker={e.id}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setOpenPayerId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setOpenPayerId(null);
                          event.currentTarget.querySelector('[aria-haspopup="menu"]')?.focus();
                          event.stopPropagation();
                        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                          const options = Array.from(event.currentTarget.querySelectorAll('[role="menuitemradio"]'));
                          const currentIndex = options.indexOf(document.activeElement);
                          if (currentIndex >= 0) {
                            event.preventDefault();
                            const nextIndex = event.key === 'Home' ? 0
                              : event.key === 'End' ? options.length - 1
                                : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                            options[nextIndex]?.focus();
                          } else if (event.target === event.currentTarget.querySelector('[aria-haspopup="menu"]')) {
                            event.preventDefault();
                            setOpenPayerId(e.id);
                          }
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="payer-select"
                        aria-haspopup="menu"
                        aria-expanded={openPayerId === e.id}
                        aria-controls={`payer-menu-${e.id}`}
                        aria-label={`Paid by ${e.paidBy}. Choose payer for ${e.name}`}
                        onClick={() => setOpenPayerId((id) => id === e.id ? null : e.id)}
                      >
                        {e.paidBy}
                        <span className="payer-chevron" aria-hidden="true" />
                      </button>
                      {openPayerId === e.id && (
                        <div className="payer-menu" id={`payer-menu-${e.id}`} role="menu" aria-label={`Choose who paid for ${e.name}`}>
                          {e.people.map((person) => (
                            <button
                              key={person}
                              type="button"
                              className="payer-option"
                              role="menuitemradio"
                              aria-checked={e.paidBy === person}
                              onClick={() => {
                                updatePayer(e.id, person);
                                setOpenPayerId(null);
                                document.querySelector(`[data-payer-picker="${e.id}"] [aria-haspopup="menu"]`)?.focus();
                              }}
                            >
                              <span>{person}</span>
                              {e.paidBy === person && <span className="payer-check" aria-hidden="true">✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </span>
                  ) : e.paidBy}
                </div>
                
                {/* Renders split breakdown if people array exists */}
                {e.people && e.people.length > 0 && (
                  <div style={styles.itemSplit}>
                    Split with: {e.people.join(', ')} ({inr(e.each)} each)
                  </div>
                )}
              </div>
              <div style={styles.itemAmount}>{inr(e.amount)}</div>
              <button style={styles.remove} onClick={() => removeExpense(e.id)} aria-label={`Remove ${e.name}`}>×</button>
            </div>
          ))}
        </div>

        {/* Total */}
        <div style={styles.total}>Total {inr(total)}</div>
      </div>

      <p style={styles.footnote}>
        SplitSmart starter · deepEntra Academy — Build &amp; Ship It.<br />
        This is the basic app — you&apos;ll add the AI and a real database next.
      </p>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '28px 16px 48px',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: 'var(--card)',
    borderRadius: 24,
    boxShadow: '0 24px 60px -24px rgba(13,27,62,.28)',
    border: '1px solid var(--line)',
    padding: 20,
    marginTop: 12,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: {
    width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center',
    color: '#fff', fontWeight: 800, fontSize: 18,
    background: 'linear-gradient(135deg, var(--blue), var(--cyan))',
    boxShadow: '0 8px 18px -6px rgba(28,95,212,.55)',
  },
  title: { fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' },
  groupPill: {
    fontSize: 12.5, fontWeight: 800, color: 'var(--blue)',
    background: 'rgba(28,95,212,.1)', padding: '6px 12px', borderRadius: 999,
  },
  addRow: { display: 'flex', gap: 10, marginBottom: 16 },
  input: {
    flex: 1, border: '1px solid var(--line)', borderRadius: 14, padding: '13px 15px',
    fontSize: 15, outline: 'none', background: '#f7f9fc', color: 'var(--ink)',
  },
  addBtn: {
    flex: 'none', width: 48, borderRadius: 14, border: 'none', color: '#fff', fontSize: 24, fontWeight: 700,
    background: '#1749A6',
    boxShadow: '0 10px 22px -8px rgba(23,73,166,.6)',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 },
  empty: { color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' },
  item: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#f7f9fc', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px',
  },
  itemEmoji: {
    width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center',
    background: '#fff', border: '1px solid var(--line)', fontSize: 19, flex: 'none',
  },
  itemMain: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: 700, fontSize: 15 },
  itemPaid: { color: 'var(--muted)', fontSize: 12.5, marginTop: 1 },
  itemSplit: { color: '#1749A6', fontSize: 12, fontWeight: 600, marginTop: 3 }, // Styling for the split details line
  itemAmount: { fontWeight: 800, fontSize: 15.5, fontVariantNumeric: 'tabular-nums' },
  remove: {
    flex: 'none', width: 26, height: 26, borderRadius: 8, border: 'none',
    background: 'transparent', color: 'var(--muted)', fontSize: 20, lineHeight: 1,
  },
  total: {
    textAlign: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)',
    fontWeight: 800, fontSize: 16, color: 'var(--ink)',
  },
  footnote: { color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', lineHeight: 1.6, marginTop: 20, maxWidth: 420 },
};