'use strict';

const byId = (id) => document.getElementById(id);
const language = window.KwanjaLanguage || {
  code: 'en',
  text: (message, values = {}) => (message ?? '').replace(/\{(\w+)\}/g, (token, name) => values[name] ?? token),
  html: (chunks, ...values) => chunks.reduce((sum, chunk, index) => sum + chunk + (values[index] ?? ''), ''),
};
const { text: t, html } = language;
const storageKey = 'kwanja-demo-ledger';
// config.js sets window.KWANJA_API: '' = same origin as the page, 'https://api.example.com' = a separate API origin, null = offline demo.
const apiBase = window.KWANJA_API === undefined ? '' : window.KWANJA_API;
const apiMode = apiBase !== null && (location.protocol === 'http:' || location.protocol === 'https:');
const pwaEnabled = window.KWANJA_PWA === true && 'serviceWorker' in navigator;
const demoBusiness = 'Westlands Device Repair';
const nairobiDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
});
let dateFormat;
let pickerDateFormat;
let pickerMonthFormat;
function updateDateFormats() {
  const locale = language.code === 'sw' ? 'sw-KE' : 'en-KE';
  dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  pickerDateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  pickerMonthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
}
updateDateFormats();
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const swahiliWeekdays = ['Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms', 'Jpl'];
const numberFormat = new Intl.NumberFormat('en-KE');
const decimalFormat = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const directions = { receivable: 'Owed to you', payable: 'You owe' };
const entryKinds = { repair: 'Repair', device_sale: 'Device sale', parts: 'Parts', other: 'Other' };
const pageTitles = { overview: 'Overview', ledger: 'Ledger', contacts: 'Contacts', settings: 'Settings' };
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function ledgerDay() {
  const [day, month, year] = nairobiDate.format().split('/').map(Number);
  return new Date(year, month - 1, day);
}

function localDate(date = ledgerDay()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

function daysFromToday(days) {
  const date = ledgerDay();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function displayDate(value) {
  return dateFormat.format(new Date(`${value}T00:00:00`));
}

function formatAmount(cents) {
  return (cents % 100 === 0 ? numberFormat : decimalFormat).format(cents / 100).replace(/^-/, '−');
}

const money = (cents) => `KES\u00a0${formatAmount(cents)}`;
const icon = (name) => html`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const paidTotal = (entry) => entry.payments.reduce((sum, payment) => sum + payment.cents, 0);
const outstanding = (entry) => entry.cents - paidTotal(entry);
const isOverdue = (entry) => Boolean(entry.due && entry.due < localDate() && outstanding(entry) > 0);
const followUpDay = (entry) => entry.promised_on || entry.due || entry.pickup_on || '';
const plural = (count, singular, pluralForm = `${singular}s`) => {
  const noun = t(count === 1 ? singular : pluralForm);
  return language.code === 'sw' ? `${noun} ${count}` : `${count} ${noun}`;
};
const empty = (message) => html`<p class="empty">${t(message)}</p>`;
const emptyLedger = () => html`<div class="empty-state"><span class="coin" aria-hidden="true">${icon('ledger')}</span><strong>Your ledger is empty</strong>
  <p>Record who owes you, and who you owe. Reminders and payments come next.</p>
  <button class="button primary" type="button" data-action="new">Add your first debt</button></div>`;

function sampleRepair() {
  return {
    id: 'sample-repair', contact: 'Amina Mwangi', note: 'Laptop screen replacement', direction: 'receivable',
    kind: 'repair', job_reference: 'WS-014', cents: 820000, due: daysFromToday(-2), pickup_on: daysFromToday(-2),
    date: daysFromToday(-5), payments: [{ cents: 200000, date: daysFromToday(-5), is_deposit: true }],
  };
}

function seedLedger() {
  return [
    sampleRepair(),
    { id: 'metro', contact: 'Metro IT Services', note: 'Refurbished laptop', direction: 'receivable', kind: 'device_sale', job_reference: 'SALE-082', cents: 3040000, due: daysFromToday(7), date: daysFromToday(-7), payments: [{ cents: 500000, date: daysFromToday(-7), is_deposit: true }] },
    { id: 'parts', contact: 'City Parts Supply', note: 'Replacement screens and SSDs', direction: 'payable', kind: 'parts', cents: 1840000, due: daysFromToday(4), date: daysFromToday(-9), payments: [] },
    { id: 'brian', contact: 'Brian Otieno', note: 'Phone charging port replacement', direction: 'receivable', kind: 'repair', job_reference: 'WS-019', cents: 350000, due: localDate(), pickup_on: localDate(), date: daysFromToday(-1), payments: [] },
  ];
}

function readLedger() {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : seedLedger();
  } catch {
    return seedLedger();
  }
}

let entries = apiMode ? [] : readLedger();
let workshopLedger = !apiMode;
let guidedRepair = sampleRepair();
let businessName = demoBusiness;
let apiReady = !apiMode;
let toastTimeout;
let activeEntry;
let returnFocus;
const dialog = byId('dialog');
const dialogContent = byId('dialog-content');

function notify(message) {
  clearTimeout(toastTimeout);
  byId('toast').textContent = t(message);
  toastTimeout = setTimeout(() => { byId('toast').textContent = ''; }, 3400);
}

function saveLedger(nextEntries, message) {
  if (apiMode) {
    entries = nextEntries;
    render();
    notify(message);
    return;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextEntries));
  } catch {
    message += ' Browser storage is unavailable.';
  }
  entries = nextEntries;
  render();
  notify(message);
}

let clerk = null;
let authMode = apiMode ? 'pending' : 'offline';

async function authHeaders() {
  if (!clerk?.session) return {};
  const token = await clerk.session.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  if (!navigator.onLine) throw new Error('You’re offline. Reconnect and try again.');
  const response = await fetch(`${apiBase}/api${path}`, { ...options, headers: { ...options.headers, ...(await authHeaders()) }, cache: 'no-store' });
  if (response.status === 401 && authMode === 'clerk') {
    await leaveSession({ expired: true });
    throw new Error('Your session has ended. Sign in again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Kwanja could not complete this request.');
  }
  return response;
}

async function loadApiLedger() {
  const status = byId('connection-status');
  status.hidden = false;
  status.textContent = t('Loading ledger…');
  document.querySelectorAll('[data-action="new"], [data-action="export"]').forEach((button) => { button.disabled = true; });
  try {
    const [business, debts] = await Promise.all(['/business', '/entries'].map(async (path) => (await api(path)).json()));
    businessName = business.name;
    entries = debts;
    apiReady = true;
    status.hidden = true;
    document.querySelectorAll('[data-action="new"], [data-action="export"]').forEach((button) => { button.disabled = false; });
  } catch {
    status.innerHTML = html`<span>Could not connect to the ledger.</span> <button class="button" type="button" data-action="retry">Try again</button>`;
  }
  render();
  if (status.hidden) offerWalkthrough();
}

async function submitToApi(form, path, payload, idempotent = true) {
  const data = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (idempotent) {
    if (form.dataset.payload !== data) {
      form.dataset.payload = data;
      form.dataset.requestKey = crypto.randomUUID();
    }
    headers['Idempotency-Key'] = form.dataset.requestKey;
  }
  form.dataset.busy = 'true';
  const buttons = [...form.querySelectorAll('button:not(:disabled)'), dialog.querySelector('[data-action="close"]')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    return await (await api(path, { method: 'POST', headers, body: data })).json();
  } catch (error) {
    showError(form, error.message === 'Failed to fetch' ? 'Connection lost. Try again when you are back online.' : error.message);
    return null;
  } finally {
    delete form.dataset.busy;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function avatar(name) {
  const initials = name.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  const color = [...name].reduce((sum, char) => sum + char.codePointAt(0), 0) % 4;
  return html`<span class="contact-avatar avatar-${color}" aria-hidden="true">${escape(initials)}</span>`;
}

function entryStatus(entry) {
  if (!outstanding(entry)) return { text: t('Settled'), color: 'paid' };
  if (isOverdue(entry)) return { text: `${t('Overdue')} · ${displayDate(entry.due)}`, color: 'overdue' };
  if (entry.due) return { text: t('Due {date}', { date: displayDate(entry.due) }), color: '' };
  return { text: t('Open'), color: '' };
}

function entryDescription(entry) {
  return [t(entryKinds[entry.kind]), entry.job_reference, entry.note].filter(Boolean).join(' · ') || t(directions[entry.direction]);
}

const signed = (entry) => (!outstanding(entry) ? money(entry.cents) : `${entry.direction === 'payable' ? '\u2212' : '+'}${money(outstanding(entry))}`);

function entryRow(entry, compact = false) {
  const status = entryStatus(entry);
  return html`<button class="entry-row${compact === true ? ' compact' : ''}" type="button" data-action="detail" data-direction="${entry.direction}" data-settled="${!outstanding(entry)}" data-entry="${escape(entry.id)}">
    ${compact === true ? '' : avatar(entry.contact)}
    <span class="row-main"><strong>${escape(compact === true ? entryDescription(entry) : entry.contact)}</strong><small>${compact === true ? `${t(directions[entry.direction])} · ${t('added')} ${displayDate(entry.date)}` : escape(entryDescription(entry))}</small></span>
    <span class="row-side"><strong class="row-amount"><span class="sr-only">${t(directions[entry.direction])}, </span>${signed(entry)}</strong>
    <small class="row-status ${status.color}">${status.text}</small></span>
  </button>`;
}

function entryCard(entry) {
  const status = entryStatus(entry);
  const settled = !outstanding(entry);
  return html`<button class="debt-card ${settled ? 'settled' : entry.direction}" type="button" data-action="detail" data-direction="${entry.direction}" data-entry="${escape(entry.id)}">
    <span class="dc-top"><strong class="dc-name">${escape(entry.contact)}</strong><span class="dc-chip ${status.color}">${status.text}</span></span>
    <span class="dc-amount"><span class="sr-only">${t(directions[entry.direction])}, </span>${money(settled ? entry.cents : outstanding(entry))}</span>
    <span class="dc-foot"><span>${escape(entryDescription(entry))}</span><span>${t(directions[entry.direction])}</span></span>
    <span class="dc-mark" aria-hidden="true">Kwanja</span>
  </button>`;
}

function sortedEntries() {
  return [...entries].sort((left, right) => right.date.localeCompare(left.date));
}

function followUpQueue(receivables, today) {
  return receivables.filter((entry) => followUpDay(entry) && followUpDay(entry) <= today)
    .sort((a, b) => followUpDay(a).localeCompare(followUpDay(b)));
}

function renderFollowUp(due, today) {
  const groups = [
    ['Overdue', due.filter((entry) => followUpDay(entry) < today)],
    ['Due today', due.filter((entry) => followUpDay(entry) === today)],
  ];
  byId('follow-all').hidden = !due.length;
  return groups.filter(([, group]) => group.length).map(([title, group]) => html`<div class="follow-group"><h3>${t(title)} <span>${group.length}</span></h3>
    ${group.slice(0, 4).map((entry) => html`<div class="follow-item"><button class="follow-record" type="button" data-action="detail" data-entry="${escape(entry.id)}">
      <strong>${escape(entry.contact)}</strong><small>${escape(entryDescription(entry))}</small>
      ${entry.last_follow_up ? html`<small>${t('Last contacted')} ${displayDate(entry.last_follow_up)}</small>` : ''}
      <span class="row-amount">${money(outstanding(entry))}</span>
    </button><button class="round" type="button" data-action="remind" data-entry="${escape(entry.id)}" aria-label="${escape(t('Open WhatsApp draft for {contact}', { contact: entry.contact }))}">${icon('whatsapp')}</button></div>`).join('')}
    </div>`).join('') || empty('No customer balances need follow-up today.');
}

function renderOverview() {
  const open = entries.filter((entry) => outstanding(entry) > 0);
  const receivable = open.filter((entry) => entry.direction === 'receivable');
  const payable = open.filter((entry) => entry.direction === 'payable');
  const receiveTotal = receivable.reduce((sum, entry) => sum + outstanding(entry), 0);
  const payTotal = payable.reduce((sum, entry) => sum + outstanding(entry), 0);
  const overdue = receivable.filter(isOverdue).sort((a, b) => a.due.localeCompare(b.due));
  const overdueTotal = overdue.reduce((sum, entry) => sum + outstanding(entry), 0);
  const today = localDate();
  const queue = workshopLedger ? followUpQueue(receivable, today) : overdue;

  // Older installed pages can still request the legacy script URL during the update.
  const walletLayout = byId('net-amount').closest('.wallet-net');
  byId('net-amount').textContent = walletLayout ? money(receiveTotal - payTotal) : formatAmount(receiveTotal - payTotal);
  const overdueChip = byId('overdue-chip');
  overdueChip.hidden = !overdueTotal;
  overdueChip.innerHTML = overdueTotal ? t('{amount} overdue', { amount: `<b>${money(overdueTotal)}</b>` }) : '';
  byId('receivable-total').textContent = walletLayout ? formatAmount(receiveTotal) : money(receiveTotal);
  byId('payable-total').textContent = walletLayout ? formatAmount(payTotal) : money(payTotal);
  byId('receivable-count').textContent = plural(receivable.length, 'open debt');
  byId('payable-count').textContent = plural(payable.length, 'open bill');

  byId('follow-section').hidden = !entries.length;
  byId('recent-section').hidden = !entries.length;
  byId('legacy-follow-add').hidden = workshopLedger;
  const first = queue[0];
  const bannerTitle = workshopLedger ? plural(queue.length, 'balance to follow up', 'balances to follow up') : `${plural(overdue.length, 'debt')} · ${t('Overdue')}`;
  const bannerDetail = workshopLedger ? t('Start with {contact}.', { contact: first?.contact || '' }) : t('{amount} is past due. Start with {contact}.', { amount: money(overdueTotal), contact: first?.contact || '' });
  byId('banner').innerHTML = !entries.length
    ? html`<div class="banner-copy"><strong>Start your ledger</strong><p>Record a repair deposit, a device sale on credit, or a parts bill.</p></div><button class="coin" type="button" data-action="new" aria-label="Add your first debt">${icon('plus')}</button>`
    : first
    ? html`<div class="banner-copy"><strong>${bannerTitle}</strong><p>${escape(bannerDetail)}</p></div>
       <button class="coin" type="button" data-action="remind" data-entry="${escape(first.id)}" aria-label="${escape(t('Open WhatsApp draft for {contact}', { contact: first.contact }))}">${icon('whatsapp')}</button>`
    : html`<div class="banner-copy"><strong>All caught up</strong><p>${t(workshopLedger ? 'No customer balances need follow-up today.' : 'Nobody owes you past their due date.')}</p></div><span class="coin" aria-hidden="true">${icon('check')}</span>`;

  const chase = [...open].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  const followList = byId('follow-list');
  followList.classList.toggle('chase-row', !workshopLedger);
  followList.classList.toggle('workshop-follow-list', workshopLedger);
  followList.innerHTML = workshopLedger ? renderFollowUp(queue, today) : chase.map((entry) => html`<button class="chase" type="button" data-action="detail" data-entry="${escape(entry.id)}" data-direction="${entry.direction}">
    <span class="chase-face">${avatar(entry.contact)}<span class="chase-badge ${entry.direction}" aria-hidden="true">${icon(entry.direction === 'receivable' ? 'in' : 'out')}</span></span>
    <span class="chase-name">${escape(entry.contact.split(/\s+/)[0])}</span></button>`).join('') || empty('Nothing open yet.');
  byId('recent-list').innerHTML = sortedEntries().slice(0, 4).map(entryRow).join('') || empty('Nothing here yet.');
}

function route() {
  const [page, filter] = location.hash.slice(1).split('/');
  const selectedFilter = ['receivable', 'payable', 'paid'].includes(filter) || (filter === 'followup' && workshopLedger) ? filter : 'all';
  return { page: Object.hasOwn(pageTitles, page) && byId(`${page}-view`) ? page : 'overview', filter: selectedFilter };
}

function isWorkspaceRoute() {
  return Object.hasOwn(pageTitles, location.hash.slice(1).split('/')[0]);
}

const searchText = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const searchReference = (value) => searchText(value).replace(/[\s./_-]+/g, '');

function ledgerResults(filter, query) {
  const reference = searchReference(query);
  const phoneDigits = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, '') : '';
  const base = filter === 'followup'
    ? followUpQueue(entries.filter((entry) => entry.direction === 'receivable' && outstanding(entry) > 0), localDate()) : sortedEntries();
  return base.filter((entry) => {
    const matchesFilter = filter === 'all' || filter === 'followup' || (filter === 'paid' ? !outstanding(entry) : filter === entry.direction && outstanding(entry) > 0);
    if (!matchesFilter) return false;
    if (!query || searchText(`${entry.contact} ${entryDescription(entry)}`).includes(query)) return true;
    if (reference && entry.job_reference && searchReference(entry.job_reference).includes(reference)) return true;
    if (!phoneDigits || !entry.phone) return false;
    const mobile = kenyanMobile(entry.phone);
    const storedDigits = (mobile || entry.phone).replace(/\D/g, '');
    return storedDigits.includes(phoneDigits) || Boolean(mobile && `0${storedDigits.slice(3)}`.includes(phoneDigits));
  });
}

function renderLedger() {
  const { filter } = route();
  const query = searchText(byId('search').value);
  const rows = ledgerResults(filter, query);
  document.querySelectorAll('[data-filter]').forEach((link) => {
    if (link.dataset.filter === filter) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });

  const owedTo = rows.filter((entry) => entry.direction === 'receivable').reduce((sum, entry) => sum + outstanding(entry), 0);
  const owe = rows.filter((entry) => entry.direction === 'payable').reduce((sum, entry) => sum + outstanding(entry), 0);
  byId('ledger-sub').textContent = [query ? plural(rows.length, 'match', 'matches') : plural(rows.length, 'entry', 'entries'), owedTo ? t('{amount} owed to you', { amount: money(owedTo) }) : '', owe ? t('{amount} you owe', { amount: money(owe) }) : ''].filter(Boolean).join(' · ');
  const list = byId('ledger-list');
  if (rows.length && query) {
    list.innerHTML = html`<div class="search-results">${rows.map((entry) => entryRow(entry)).join('')}</div>`;
  } else {
    list.innerHTML = rows.map(entryCard).join('') || (entries.length
      ? empty(query ? (filter === 'all' ? 'No entries match your search.' : 'No matches in this filter. Choose All to search the full ledger.') : 'No entries in this view.')
      : emptyLedger());
  }
}

function renderContacts() {
  const groups = new Map();
  for (const entry of sortedEntries()) {
    const name = entry.contact.toLocaleLowerCase();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  }
  byId('contacts-sub').textContent = plural(groups.size, 'contact');
  byId('contacts-list').innerHTML = [...groups.values()]
    .sort((a, b) => a[0].contact.localeCompare(b[0].contact))
    .map((contactEntries) => {
      const net = contactEntries.reduce((sum, entry) => sum + (entry.direction === 'payable' ? -outstanding(entry) : outstanding(entry)), 0);
      const open = contactEntries.filter((entry) => outstanding(entry) > 0).length;
      const tone = net > 0 ? 'receivable' : net < 0 ? 'payable' : 'settled';
      const amount = net === 0 ? (open ? money(0) : t('Settled')) : `${net > 0 ? '+' : '\u2212'}${money(Math.abs(net))}`;
      return html`<section class="contact-group"><header class="cg-head">${avatar(contactEntries[0].contact)}
        <span class="row-main"><h2>${escape(contactEntries[0].contact)}</h2><small>${open ? plural(open, 'open entry', 'open entries') : t('All settled')}</small></span>
        <strong class="cg-net ${tone}">${amount}</strong></header>
        ${contactEntries.map((entry) => entryRow(entry, true)).join('')}</section>`;
    })
    .join('') || empty('Add a debt to add your first contact.');
}

function render() {
  const { page } = route();
  for (const name of Object.keys(pageTitles)) {
    const view = byId(`${name}-view`);
    if (view) view.hidden = !apiReady || name !== page;
  }
  const overviewPrivacy = byId('overview-privacy');
  if (overviewPrivacy) overviewPrivacy.hidden = !apiReady || page !== 'overview';
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  byId('account').hidden = authMode !== 'clerk' || !clerk?.user;
  if (!byId('account').hidden) byId('account-email').textContent = clerk.user.primaryEmailAddress?.emailAddress || '';
  byId('account').querySelector('[data-action="account-security"]').hidden = !passwordAuthEnabled();
  byId('follow-filter').hidden = !workshopLedger;
  byId('import-entry').hidden = !apiMode || !workshopLedger;
  byId('page-title').textContent = t(pageTitles[page]);
  byId('page-context').textContent = page === 'overview' && authMode !== 'clerk' ? `${businessName} · ${t('Demo workspace')}` : businessName;
  if (page === 'overview') renderOverview();
  if (page === 'ledger') renderLedger();
  if (page === 'contacts') renderContacts();
}

function showDialog(title, content, focusSelector) {
  if (!dialog.open) returnFocus = document.activeElement;
  byId('dialog-title').textContent = title;
  dialogContent.innerHTML = content;
  if (!dialog.open) dialog.showModal();
  const target = focusSelector && dialogContent.querySelector(focusSelector);
  if (target) target.focus();
  else byId('dialog-title').focus();
  dialog.scrollTop = 0;
}

const walkthroughSteps = [
  ['Add your first debt', 'plus', 'Use the + button to log what a customer owes you or what you owe a supplier.'],
  ['Record a payment', 'check', 'Open a ledger entry and choose Record payment. Enter the amount received or paid. A partial payment reduces the outstanding balance and appears in the payment history.'],
  ['Follow up on a balance', 'whatsapp', 'Check Follow up on Overview for customer balances due. Open a WhatsApp reminder to review the message before sending it.'],
];
const seenWalkthroughs = new Set();

function walkthroughKey() {
  if (authMode === 'clerk') return clerk?.user?.id ? `kwanja-walkthrough:${clerk.user.id}` : '';
  return 'kwanja-walkthrough:demo';
}

function offerWalkthrough() {
  if (dialog.open || !welcome.hidden || (authMode === 'clerk' && entries.length)) return;
  const key = walkthroughKey();
  if (!key || seenWalkthroughs.has(key)) return;
  try { if (localStorage.getItem(key)) return; } catch { /* storage unavailable */ }
  if (!byId('main').contains(document.activeElement)) byId('main').focus({ preventScroll: true });
  showWalkthrough();
}

function showWalkthrough(index = 0) {
  const [title, symbol, copy] = walkthroughSteps[index];
  const last = index === walkthroughSteps.length - 1;
  let description = t(copy);
  if (workshopLedger && index === 0) description += ' ' + t('For a repair, you can include the job reference, deposit and pickup date.');
  if (!workshopLedger && last) description = t('Open a customer’s unpaid entry and choose WhatsApp reminder. Review the amount and message before sending it.');
  showDialog(t(title), html`<div class="walkthrough" data-walkthrough-step="${index}">
    <div class="walkthrough-card">
      <span class="walkthrough-icon">${icon(symbol)}</span>
      <div><p class="walkthrough-count">${t('Step {step} of {total}', { step: index + 1, total: walkthroughSteps.length })}</p><p>${description}</p></div>
    </div>
    <div class="walkthrough-actions">
      <button class="link" type="button" data-action="close">${t(last ? 'Done' : 'Skip walkthrough')}</button>
      <div>
        ${index ? html`<button class="button" type="button" data-action="walkthrough-back">Back</button>` : ''}
        <button class="button primary" type="button" data-action="${last ? 'walkthrough-add' : 'walkthrough-next'}">${t(last ? 'Add a debt' : 'Next')}</button>
      </div>
    </div>
  </div>`);
}

function rememberWalkthrough() {
  const key = walkthroughKey();
  if (!key) return;
  seenWalkthroughs.add(key);
  try { localStorage.setItem(key, '1'); } catch { /* storage unavailable */ }
}

function field(label, control, help = '') {
  return html`<label class="field"><span>${t(label)}</span>${control}${help ? html`<small>${t(help)}</small>` : ''}</label>`;
}

function dateField(label, name, value = '', help = '') {
  return html`<div class="field date-field">
    <span id="date-label-${name}">${t(label)}</span>
    <input type="hidden" name="${name}" value="${escape(value)}">
    <details class="date-picker">
      <summary aria-labelledby="date-label-${name} date-value-${name}" ${help ? `aria-describedby="date-help-${name}"` : ''}>
        <span id="date-value-${name}" class="date-value" data-empty="${!value}">${value ? pickerDateFormat.format(new Date(`${value}T00:00:00`)) : t('Choose a date')}</span>
        <svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg>
      </summary>
      <div class="date-panel"></div>
    </details>
    ${help ? html`<small id="date-help-${name}">${t(help)}</small>` : ''}
  </div>`;
}

function renderCalendar(picker, date, focusDay = false) {
  const today = localDate();
  const selected = picker.previousElementSibling.value;
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(date);
  first.setDate(1);
  const last = new Date(first);
  last.setMonth(month + 1, 0);
  const offset = (first.getDay() + 6) % 7;
  const panel = picker.querySelector('.date-panel');
  panel.innerHTML = html`<div class="date-heading">
    <button type="button" data-month="-1" aria-label="Previous month"${year === 1 && month === 0 ? ' disabled' : ''}><svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg></button>
    <strong aria-live="polite">${pickerMonthFormat.format(date)}</strong>
    <button type="button" data-month="1" aria-label="Next month"${year === 9999 && month === 11 ? ' disabled' : ''}><svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg></button>
  </div>
  <div class="date-days">
    ${weekdays.map((day, index) => html`<abbr title="${t(day)}">${language.code === 'sw' ? swahiliWeekdays[index] : day.slice(0, 2)}</abbr>`).join('')}
    ${'<span aria-hidden="true"></span>'.repeat(offset)}
    ${Array.from({ length: last.getDate() }, (_, index) => {
      const day = new Date(first);
      day.setDate(index + 1);
      const value = localDate(day);
      return html`<button type="button" data-day="${value}" aria-label="${pickerDateFormat.format(day)}" aria-pressed="${selected === value}"${value === today ? ' aria-current="date"' : ''} tabindex="${day.getDate() === date.getDate() ? 0 : -1}">${day.getDate()}</button>`;
    }).join('')}
  </div>
  <div class="date-actions">
    <button type="button" data-set-date="${today}">Today</button>
    <button type="button" data-set-date=""${selected ? '' : ' disabled'}>Clear date</button>
  </div>`;
  if (focusDay) panel.querySelector('[data-day][tabindex="0"]').focus();
}

function selectCalendarDate(picker, value) {
  picker.previousElementSibling.value = value;
  const label = picker.querySelector('.date-value');
  label.textContent = value ? pickerDateFormat.format(new Date(`${value}T00:00:00`)) : t('Choose a date');
  label.dataset.empty = String(!value);
  picker.open = false;
  picker.querySelector('summary').focus();
}

function showNew(previous = null) {
  const names = [...new Set(entries.map((entry) => entry.contact))];
  const payable = previous?.direction === 'payable';
  showDialog(t('Add debt'), html`<form class="form" data-form="new">
    <div class="segment" role="radiogroup" aria-label="Direction">
      <label><input type="radio" name="direction" value="receivable"${payable ? '' : ' checked'}><span>Owed to you</span></label>
      <label><input type="radio" name="direction" value="payable"${payable ? ' checked' : ''}><span>You owe</span></label>
    </div>
    ${field('Contact', previous
      ? html`<input name="contact" value="${escape(previous.contact)}" readonly>`
      : html`<input name="contact" maxlength="80" list="contact-names" placeholder="Customer or supplier name" required>`)}
    <datalist id="contact-names">${names.map((name) => html`<option value="${escape(name)}"></option>`).join('')}</datalist>
    ${field('Total amount (KES)', html`<input class="big" name="amount" type="number" inputmode="decimal" min="0.01" max="1000000000" step="0.01" placeholder="0" required>`)}
    ${workshopLedger ? html`<div class="field-grid">
      ${field('Job or sale type', html`<select name="kind"><option value="">Choose a type</option>${Object.entries(entryKinds).map(([key, label]) => html`<option value="${key}">${t(label)}</option>`).join('')}</select>`)}
      ${field('Reference (optional)', html`<input name="job_reference" maxlength="40" placeholder="e.g. WS-014">`)}
    </div>
    <label class="field"${payable ? ' hidden' : ''}><span>Customer deposit already paid (optional)</span><input name="deposit" type="number" min="0" max="1000000000" step="0.01" inputmode="decimal" placeholder="KES"${payable ? ' disabled' : ''}></label>
    ${dateField('Pickup date (optional)', 'pickup_on')}
    ${field('Contact’s mobile number (optional)', html`<input name="phone" type="tel" inputmode="tel" maxlength="24" placeholder="07XX XXX XXX" value="${escape(previous?.phone || '')}">`)}` : ''}
    ${dateField('Payment due date (optional)', 'due')}
    ${field('Note (optional)', html`<input name="note" maxlength="120" placeholder="e.g. Screen replacement">`)}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Save debt</button></div>
  </form>`, previous ? '[name=amount]' : '[name=contact]');
}

function showDetail(entry) {
  activeEntry = entry;
  const balance = outstanding(entry);
  const status = entryStatus(entry);
  const actions = balance > 0 ? html`<div class="detail-actions">
    <button class="button primary" type="button" data-action="payment">Record payment</button>
    ${entry.direction === 'receivable' ? html`<button class="button" type="button" data-action="reminder">${icon('whatsapp').replace('class="icon"', 'class="icon wa"')} ${t('WhatsApp reminder')}</button>` : ''}
  </div>` : '';
  const history = [...entry.payments].reverse().map((payment) => html`<li>
    <span>${displayDate(payment.date)}${payment.is_deposit ? ` · ${t('Deposit')}` : ''}${payment.reference ? ` · ${escape(payment.reference)}` : ''}</span><strong>${money(payment.cents)}</strong>
  </li>`).join('');
  const deposit = entry.payments.find((payment) => payment.is_deposit);
  const details = [
    entry.phone && ['Mobile number', entry.phone],
    entry.pickup_on && ['Pickup', displayDate(entry.pickup_on)],
    entry.promised_on && ['Promised payment', displayDate(entry.promised_on)],
    entry.last_follow_up && ['Last contacted', displayDate(entry.last_follow_up)],
  ].filter(Boolean);
  showDialog(entry.contact, html`<div class="detail-summary ${balance ? entry.direction : 'settled'}"><p>${t(directions[entry.direction])} · ${status.text}</p>
    <strong class="detail-amount">${money(balance)}</strong><p>${t('Original amount')} ${money(entry.cents)}${deposit ? ` · ${t('Deposit')} ${money(deposit.cents)}` : ''}</p></div>
    <p class="detail-meta">${t('Added')} ${displayDate(entry.date)} · ${escape(entryDescription(entry))}</p>
    ${details.length ? html`<dl class="workshop-meta">${details.map(([label, value]) => html`<div><dt>${t(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : ''}
    ${actions}
    <div class="detail-tools">
      ${workshopLedger ? html`<button class="link workshop-details" type="button" data-action="follow-up">${t(entry.direction === 'receivable' ? 'Follow-up details' : 'Contact number')}</button>` : ''}
      <button class="link workshop-details" type="button" data-action="repeat-entry">New entry for this contact</button>
    </div>
    <section class="detail-history"><h3>Payment history</h3>${history ? html`<ul>${history}</ul>` : html`<p class="help">No payments recorded yet.</p>`}</section>`);
}

const digitsLabel = (value) => {
  const [whole, decimals] = String(value).split('.');
  return `${whole ? numberFormat.format(Number(whole)) : '0'}${decimals === undefined ? '' : `.${decimals}`}`;
};

function setPayAmount(value) {
  const form = dialogContent.querySelector('[data-form=payment]');
  if (!form) return;
  form.elements.amount.value = value;
  const display = form.querySelector('.pay-amount');
  display.querySelector('b').textContent = digitsLabel(value);
  display.classList.toggle('over', amountToCents(value) > outstanding(activeEntry));
  display.classList.toggle('empty-amount', !value);
  form.querySelector('.form-error').hidden = true;
}

function pressKey(button) {
  const input = dialogContent.querySelector('[name=amount]');
  let next = button.dataset.key === 'del' ? input.value.slice(0, -1) : input.value + button.dataset.key;
  next = next.replace(/^0+(?=\d)/, '');
  if (next.length <= 10) setPayAmount(next === '0' ? '' : next);
}

function showPayment(amount = '', reference = '') {
  const entry = activeEntry;
  const remaining = outstanding(entry);
  const chips = [['Full', remaining], ['Half', Math.round(remaining / 2)], ['1,000', 100000], ['500', 50000]].filter(([, cents]) => cents > 0 && cents <= remaining);
  showDialog(t('Record payment'), html`<form class="form pay" data-form="payment">
    <div class="pay-to">${avatar(entry.contact)}<span><strong>${escape(entry.contact)}</strong><small>${t(directions[entry.direction])} · ${t('{amount} remaining', { amount: money(remaining) })}</small></span></div>
    <input type="hidden" name="amount" value="${escape(String(amount))}">
    <output class="pay-amount${amount ? '' : ' empty-amount'}" aria-live="polite"><span>KES</span><b>${digitsLabel(amount)}</b></output>
    <div class="chips">${chips.map(([label, cents]) => html`<button type="button" data-action="chip" data-amount="${cents / 100}">${t(label)}</button>`).join('')}</div>
    <div class="numpad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((key) => html`<button type="button" data-action="key" data-key="${key}">${key}</button>`).join('')}<button type="button" data-action="key" data-key="del" aria-label="Delete last digit"><svg class="icon"><use href="#i-back"/></svg></button></div>
    <details class="ref"><summary>Add M-Pesa reference</summary>${field('Reference', html`<input name="reference" maxlength="40" value="${escape(reference)}" placeholder="e.g. confirmation code">`)}</details>
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Record payment</button>
    <div class="pair"><button class="button" type="button" data-action="sms"><img class="brand-mark" src="brands/mpesa.svg" alt="">Paste M-Pesa SMS</button>
    <button class="button" type="button" data-action="back">Back</button></div></div>
  </form>`);
}

function showSms() {
  showDialog(t('Paste M-Pesa SMS'), html`<form class="form" data-form="sms">
    ${field('Confirmation message', html`<textarea name="sms" rows="4" maxlength="1500" required></textarea>`, 'Review the amount before saving. Kwanja saves the payment details only.')}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Review payment</button>
    <button class="button" type="button" data-action="payment">Back</button></div>
  </form>`, '[name=sms]');
}

function reminderMessage(entry, business) {
  const date = entry.promised_on || entry.due;
  if (language.code === 'sw') {
    const job = entry.job_reference ? ` ya ${entry.kind === 'repair' ? 'ukarabati' : 'kazi'} ${entry.job_reference}` : '';
    const due = date ? ` Tarehe ${date < localDate() ? 'ya mwisho ya malipo ilikuwa' : 'ya mwisho ya malipo ni'} ${displayDate(date)}.` : '';
    return `Habari ${entry.contact}, salio lako${job} kwa ${business} ni ${money(outstanding(entry))}.${due} Tafadhali tujulishe lini unaweza kulipa. Asante!`;
  }
  const job = entry.job_reference ? ` for ${entry.kind === 'repair' ? 'repair ' : ''}${entry.job_reference}` : '';
  const due = date ? ` Payment ${date < localDate() ? 'was' : 'is'} due ${displayDate(date)}.` : '';
  return `Hi ${entry.contact}, your balance${job} with ${business} is ${money(outstanding(entry))}.${due} Please let us know when you can pay. Thank you!`;
}

function showReminder() {
  const entry = activeEntry;
  const message = reminderMessage(entry, businessName);
  showDialog(t('WhatsApp reminder'), html`<form class="form" data-form="reminder">
    ${field('Kenyan mobile number', html`<input type="tel" name="phone" placeholder="e.g. 07XX XXX XXX" maxlength="24" value="${escape(entry.phone || '')}" required>`, 'WhatsApp opens with a draft for you to review and send.')}
    ${field('Message', html`<textarea name="message" rows="5" maxlength="700" required>${escape(message)}</textarea>`)}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Open WhatsApp</button>
    <button class="button" type="button" data-action="copy">Copy message</button>
    ${workshopLedger ? html`<button class="button" type="button" data-action="follow-up">Follow-up details</button>` : ''}
    <button class="button" type="button" data-action="back">Back</button></div>
  </form>`, '[name=phone]');
}

function showFollowUp() {
  const entry = activeEntry;
  const customer = entry.direction === 'receivable';
  showDialog(t(customer ? 'Follow-up details' : 'Contact number'), html`<form class="form" data-form="follow-up">
    ${field('Saved mobile number', html`<input name="phone" type="tel" maxlength="24" placeholder="07XX XXX XXX" value="${escape(entry.phone || '')}">`, 'Used in future WhatsApp drafts for this contact.')}
    ${customer ? `${dateField('Promised payment date', 'promised_on', entry.promised_on || '', 'A promise date schedules the next follow-up. The original payment due date stays on the entry.')}
    <label class="workshop-check"><input name="contacted" type="checkbox">I contacted this customer today</label>` : ''}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Save details</button><button class="button" type="button" data-action="back">Back</button></div>
  </form>`, '[name=phone]');
}

function showError(form, message) {
  const error = form.querySelector('.form-error');
  error.dataset.message = message || '';
  error.textContent = t(message);
  error.classList.remove('success');
  error.hidden = false;
}

function amountToCents(amount) {
  return /^\d+(?:\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
}

function kenyanMobile(value) {
  const digits = (value || '').replace(/[\s()+-]/g, '');
  const phone = digits.replace(/^0(?=[17])/, '254').replace(/^(?=[17]\d{8}$)/, '254');
  return /^254[17]\d{8}$/.test(phone) ? `+${phone}` : '';
}

function contactKey(entry) {
  return entry.contact_id || entry.contact.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function saveEntryView(saved, message) {
  const key = contactKey(saved);
  const updated = entries.map((entry) => {
    if (entry.id === saved.id) return saved;
    return contactKey(entry) === key ? { ...entry, phone: saved.phone } : entry;
  });
  saveLedger(updated.some((entry) => entry.id === saved.id) ? updated : [saved, ...updated], message);
}

async function submitNew(form, values) {
  const cents = amountToCents(values.amount);
  const contact = values.contact.trim();
  if (!contact || !cents) {
    showError(form, 'Enter a contact and a positive amount with up to two decimal places.');
    return;
  }
  const phone = kenyanMobile(values.phone);
  const deposit = amountToCents(values.deposit || '0');
  if (values.phone?.trim() && !phone) {
    showError(form, 'Enter a Kenyan mobile number beginning with 07, 01 or +254.');
    return;
  }
  if (deposit > cents || (deposit && values.direction !== 'receivable')) {
    showError(form, 'Enter a customer deposit no greater than the total amount, or leave it blank.');
    return;
  }
  const ledgerFields = { contact, direction: values.direction, cents, due: values.due || null, note: values.note.trim() };
  const workshopFields = { phone: phone || null, kind: values.kind || null, job_reference: values.job_reference?.trim() || '', pickup_on: values.pickup_on || null };
  if (apiMode) {
    const payload = workshopLedger ? { ...ledgerFields, ...workshopFields, deposit_cents: deposit } : ledgerFields;
    const saved = await submitToApi(form, '/entries', payload);
    if (!saved) return;
    saveEntryView(saved, 'Debt added.');
    dialog.close();
    return;
  }
  const existing = entries.find((entry) => contactKey(entry) === contactKey({ contact }));
  if (phone && existing?.phone && existing.phone !== phone) {
    showError(form, 'This contact already has a different number. Update their number in the follow-up form.');
    return;
  }
  const id = globalThis.crypto?.randomUUID?.() ?? `debt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payments = deposit ? [{ cents: deposit, date: localDate(), is_deposit: true }] : [];
  saveEntryView({ ...ledgerFields, ...workshopFields, id, contact: existing?.contact || contact, phone: phone || existing?.phone || null, date: localDate(), payments }, 'Debt added.');
  dialog.close();
}

async function submitFollowUp(form, values) {
  const entry = activeEntry;
  const phone = kenyanMobile(values.phone);
  if (values.phone.trim() && !phone) {
    showError(form, 'Enter a Kenyan mobile number beginning with 07, 01 or +254.');
    return;
  }
  const payload = { phone: phone || null };
  if (entry.direction === 'receivable') {
    payload.promised_on = values.promised_on || null;
    payload.contacted = values.contacted === 'on';
  }
  const updated = apiMode
    ? await submitToApi(form, `/entries/${entry.id}/follow-up`, payload, false)
    : { ...entry, ...payload, last_follow_up: payload.contacted ? localDate() : entry.last_follow_up };
  if (!updated) return;
  saveEntryView(updated, 'Details saved.');
  showDetail(updated);
}

async function submitPayment(form, values) {
  const entry = activeEntry;
  const cents = amountToCents(values.amount);
  if (!cents || cents > outstanding(entry)) {
    showError(form, 'Enter an amount up to the remaining balance, with up to two decimal places.');
    return;
  }
  const reference = values.reference.trim();
  if (apiMode) {
    const updated = await submitToApi(form, `/entries/${entry.id}/payments`, { cents, reference });
    if (!updated) return;
    saveLedger(entries.map((item) => item.id === entry.id ? updated : item), outstanding(updated) ? 'Payment recorded.' : 'Debt settled.');
    dialog.close();
    return;
  }
  if (reference && entries.some((item) => item.payments.some((payment) => payment.reference.toUpperCase() === reference.toUpperCase()))) {
    showError(form, 'That payment reference is already in your ledger.');
    return;
  }
  const updated = { ...entry, payments: [...entry.payments, { cents, date: localDate(), reference }] };
  saveLedger(entries.map((item) => item.id === entry.id ? updated : item), outstanding(updated) ? 'Payment recorded.' : 'Debt settled.');
  dialog.close();
}

async function submitSms(form, values) {
  if (apiMode) {
    const suggested = await submitToApi(form, '/mpesa/preview', { message: values.sms }, false);
    if (!suggested) return;
    if (suggested.direction !== activeEntry.direction) {
      showError(form, 'This M-Pesa payment goes in the opposite direction to this debt.');
      return;
    }
    showPayment(suggested.cents / 100, suggested.reference);
    return;
  }
  const amount = values.sms.match(/\b(?:Ksh\.?|KES)\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (!amount) {
    showError(form, 'No KES amount found. Check the message or enter the payment manually.');
    return;
  }
  const reference = values.sms.match(/^\s*([A-Z0-9]{10})\s+confirmed\b/i);
  showPayment(amount[1].replaceAll(',', ''), reference?.[1].toUpperCase());
}

function submitReminder(form, values) {
  const phone = kenyanMobile(values.phone);
  if (!phone) {
    showError(form, 'Enter a Kenyan mobile number beginning with 07, 01 or +254.');
    return;
  }
  window.open(`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(values.message)}`, '_blank', 'noopener,noreferrer');
}

function renderRepairDemo() {
  byId('repair-demo-balance').textContent = t('Balance {amount}', { amount: money(outstanding(guidedRepair)) });
  const paid = guidedRepair.payments.length > 1;
  document.querySelector('[data-action="repair-demo-payment"]').disabled = paid;
  document.querySelector('[data-action="repair-demo-reset"]').hidden = !paid && byId('repair-demo-reminder').hidden;
  byId('repair-demo-message').textContent = reminderMessage(guidedRepair, demoBusiness);
}

function showImport(csv = '') {
  showDialog(t('Import CSV'), html`<form class="form" data-form="import-preview">
    <p class="help">Preview up to 200 rows. Kwanja flags invalid amounts, dates and possible duplicates before adding entries.</p>
    <button class="link" type="button" data-action="import-template">Download the CSV template</button>
    ${field('CSV file', html`<input name="file" type="file" accept=".csv,text/csv">`)}
    ${field('Or paste CSV rows', html`<textarea name="csv" rows="6" maxlength="120000" placeholder="contact,direction,amount_kes">${escape(csv)}</textarea>`)}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Preview entries</button></div>
  </form>`);
}

let stagedImport = '';

async function previewImport(form, values) {
  let csv = values.csv.trim();
  if (values.file?.size) {
    if (csv || values.file.size > 480000) {
      showError(form, csv ? 'Choose a file or paste rows. Clear the other input.' : 'The selected file is too large.');
      return;
    }
    try { csv = (await values.file.text()).trim(); } catch {
      showError(form, 'Could not read this file. Paste the CSV rows instead.');
      return;
    }
    if (!form.isConnected || !dialog.open) return;
  }
  if (!csv || csv.length > 120000) {
    showError(form, 'Choose or paste a CSV with up to 200 rows.');
    return;
  }
  const preview = await submitToApi(form, '/import/preview', { csv }, false);
  if (!preview) return;
  stagedImport = csv;
  const ready = preview.rows.filter((row) => row.status === 'ready').length;
  const skipped = preview.rows.length - ready;
  const rows = preview.rows.map((row) => html`<li><strong>${t('Row {number}', { number: row.row })}${row.contact ? ` · ${escape(row.contact)}` : ''}</strong>
    <span>${row.status === 'ready' ? `${money(row.cents)} · ${t('Ready')}` : escape(t(row.issue))}</span></li>`).join('');
  showDialog(t('Review CSV import'), html`<form class="form" data-form="import-save">
    <p class="help">${t('{ready} ready to import · {skipped} to skip.', { ready, skipped })}</p>
    <ul class="import-rows">${rows}</ul>
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit" ${ready ? '' : 'disabled'}>${t('Import {count}', { count: plural(ready, 'entry', 'entries') })}</button>
    <button class="button" type="button" data-action="import-edit">Edit CSV</button></div>
  </form>`);
}

async function saveImport(form) {
  const result = await submitToApi(form, '/import', { csv: stagedImport }, false);
  if (!result) return;
  stagedImport = '';
  dialog.close();
  await loadApiLedger();
  notify(`${plural(result.imported, 'entry', 'entries')} imported · ${result.rows.length - result.imported} skipped.`);
}

function downloadImportTemplate() {
  const text = 'contact,direction,amount_kes,note,due,pickup_on,kind,job_reference,phone,deposit_kes\r\n';
  downloadCsv(new Blob([text], { type: 'text/csv;charset=utf-8' }), 'kwanja-import-template.csv', 'Template downloaded.');
}

function showExport() {
  const { filter } = route();
  const query = searchText(byId('search').value);
  const count = ledgerResults(filter, query).length;
  const preferCurrent = count > 0 && (query || filter !== 'all' || (apiMode && !navigator.onLine));
  showDialog(t('Export CSV'), html`<form class="form" data-form="export">
    <fieldset class="export-options">
      <legend class="sr-only">Which entries to export</legend>
      <label class="export-option">
        <input type="radio" name="scope" value="full"${preferCurrent ? '' : ' checked'}>
        <span><strong>Full ledger</strong><small>${t('Every entry in your shop ledger.')}${apiMode ? ' ' + t('Requires a connection.') : ''}</small></span>
      </label>
      <label class="export-option">
        <input type="radio" name="scope" value="current"${preferCurrent ? ' checked' : ''}${count ? '' : ' disabled'}>
        <span><strong>Current results</strong><small>${count ? t('{count} in your current view.', { count: plural(count, 'entry', 'entries') }) : t('No entries match your current view.')}</small></span>
      </label>
    </fieldset>
    <p class="form-error" role="alert" hidden></p>
    <button class="button primary" type="submit">Download CSV</button>
  </form>`);
}

function ledgerCsv(entriesToExport) {
  const csvCell = (value) => {
    const text = String(value);
    const safeText = typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  };
  const rows = [['Contact', 'Direction', 'Note', 'Date added', 'Due date', 'Original (KES)', 'Paid (KES)', 'Outstanding (KES)']];
  for (const entry of entriesToExport) {
    rows.push([
      entry.contact, directions[entry.direction], entry.note || '', entry.date, entry.due || '',
      (entry.cents / 100).toFixed(2), (paidTotal(entry) / 100).toFixed(2), (outstanding(entry) / 100).toFixed(2),
    ]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

async function exportLedger(form, values) {
  if (values.scope === 'current') {
    const rows = ledgerResults(route().filter, searchText(byId('search').value));
    if (!rows.length) {
      showError(form, 'No entries match your current view.');
      return;
    }
    downloadCsv(ledgerCsv(rows), `kwanja-results-${localDate()}.csv`, t('{count} exported.', { count: plural(rows.length, 'entry', 'entries') }));
    dialog.close();
    return;
  }
  if (apiMode && !navigator.onLine) {
    showError(form, 'You’re offline. Reconnect to export the full ledger.');
    return;
  }
  const buttons = [form.querySelector('[type="submit"]'), dialog.querySelector('[data-action="close"]')];
  form.dataset.busy = 'true';
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const blob = apiMode ? await (await api('/export.csv')).blob() : ledgerCsv(sortedEntries());
    downloadCsv(blob);
    dialog.close();
  } catch {
    showError(form, 'Could not export the full ledger. Try again.');
  } finally {
    delete form.dataset.busy;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function downloadCsv(blob, filename = `kwanja-ledger-${localDate()}.csv`, message = 'Ledger exported.') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  notify(message);
}

async function copyReminder() {
  const field = dialogContent.querySelector('[name=message]');
  try {
    await navigator.clipboard.writeText(field.value);
    showError(field.form, 'Message copied.');
    field.form.querySelector('.form-error').classList.add('success');
  } catch {
    field.select();
    showError(field.form, 'Message selected. Use your device’s Copy command.');
  }
}

const clickActions = {
  new: () => showNew(),
  'find-entry': () => {
    if (!apiReady) return;
    const { page, filter } = route();
    if (page !== 'ledger' || filter !== 'all') {
      history.pushState(null, '', '#ledger');
      render();
    }
    byId('search').focus();
  },
  'repeat-entry': () => showNew(activeEntry),
  retry: loadApiLedger,
  export: showExport,
  import: () => showImport(),
  'install-app': installApp,
  walkthrough: () => showWalkthrough(),
  'walkthrough-next': (button) => showWalkthrough(Number(button.closest('.walkthrough').dataset.walkthroughStep) + 1),
  'walkthrough-back': (button) => showWalkthrough(Number(button.closest('.walkthrough').dataset.walkthroughStep) - 1),
  'walkthrough-add': () => {
    rememberWalkthrough();
    showNew();
  },
  'import-template': downloadImportTemplate,
  'import-edit': () => showImport(stagedImport),
  'repair-demo-payment': (button) => {
    if (button.disabled) return;
    guidedRepair.payments.push({ cents: 200000 });
    renderRepairDemo();
  },
  'repair-demo-reminder': () => { byId('repair-demo-reminder').hidden = false; renderRepairDemo(); },
  'repair-demo-reset': () => { guidedRepair = sampleRepair(); byId('repair-demo-reminder').hidden = true; renderRepairDemo(); },
  close: () => dialog.close(),
  detail: (button) => showDetail(entries.find((entry) => entry.id === button.dataset.entry)),
  payment: () => showPayment(),
  reminder: showReminder,
  'follow-up': showFollowUp,
  sms: showSms,
  back: () => showDetail(activeEntry),
  copy: copyReminder,
  privacy: togglePrivacy,
  key: pressKey,
  chip: (button) => setPayAmount(button.dataset.amount),
  remind: (button) => { activeEntry = entries.find((entry) => entry.id === button.dataset.entry); showReminder(); },
};
const submitActions = {
  new: submitNew, payment: submitPayment, sms: submitSms, reminder: submitReminder,
  'follow-up': submitFollowUp, 'import-preview': previewImport, 'import-save': saveImport, export: exportLedger,
};

let installPrompt;
const standalone = window.matchMedia('(display-mode: standalone)');

function showInstallButtons(installed = false) {
  document.querySelectorAll('[data-action="install-app"]').forEach((button) => {
    button.hidden = !pwaEnabled || installed || standalone.matches || navigator.standalone === true;
  });
}

async function installApp() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') showInstallButtons(true);
      return;
    } catch { /* Fall back to the browser's install steps. */ }
  }
  showDialog(t('Install Kwanja'), html`<ul class="install-guide">
    <li><strong>Android</strong><p>In Chrome, open the menu and choose Install app or Add to Home screen.</p></li>
    <li><strong>iPhone or iPad</strong><p>In Safari, open Share and choose Add to Home Screen. Turn on Open as Web App if shown, then tap Add.</p></li>
    <li><strong>Computer</strong><p>In Chrome or Edge, look for Install in the address bar or browser menu. In Safari on Mac, choose File → Add to Dock.</p></li>
  </ul>`);
}

function updateOfflineStatus() {
  const offline = apiMode && !navigator.onLine;
  byId('public-offline').hidden = !offline;
  byId('workspace-offline').hidden = !offline || !apiReady;
}

/* The public website and account setup use the same entry point as the ledger. */
const onboardedKey = 'kwanja-onboarded';
const welcome = byId('welcome');
const publicHashes = new Set(['#home', '#welcome', '#repair-demo', '#how-it-works', '#about', '#questions']);
const oauthCallback = new URLSearchParams(location.search).has('clerk_oauth');
let authIntent = 'signup';
let loginMethod = 'password';
let challenge = null;
let pendingEmail = '';
let configuredProviders = [];
let resendUntil = 0;
let resendTimer;

const authMessage = (error) => {
  const first = error?.errors?.[0];
  if (first?.code === 'form_identifier_not_found') return 'No account uses that email. Create one instead.';
  if (first?.code === 'form_identifier_exists') return 'That email already has an account. Log in instead.';
  if (['form_code_incorrect', 'verification_failed'].includes(first?.code)) return 'That code is incorrect. Try again.';
  if (first?.code === 'verification_expired') return 'That code has expired. Request a new one.';
  return first?.longMessage || error?.message || 'Something went wrong. Try again.';
};

function showStep(step, focus = true) {
  welcome.querySelectorAll('[data-step]').forEach((section) => { section.hidden = section.dataset.step !== step; });
  byId('auth-layout').hidden = step === 'intro';
  if (step !== 'intro' && focus) {
    window.scrollTo(0, 0);
    welcome.querySelector(`[data-step="${step}"] h1`)?.focus({ preventScroll: true });
  }
}

function openWelcome(step = 'intro', focus = true) {
  welcome.dataset.mode = authMode;
  welcome.hidden = false;
  document.body.classList.add('is-welcome');
  welcome.querySelector('[data-action="skip"]').hidden = !['offline', 'demo'].includes(authMode);
  showStep(step, focus);
}

function hideWelcome() {
  welcome.hidden = true;
  document.body.classList.remove('is-welcome');
  if (!location.hash || publicHashes.has(location.hash) || ['#login', '#signup'].includes(location.hash)) {
    history.replaceState(null, '', '#overview');
  }
}

async function finishDemo() {
  if (authMode === 'demo') {
    hideWelcome();
    await loadApiLedger();
    return;
  }
  try { localStorage.setItem(onboardedKey, '1'); } catch { /* storage unavailable */ }
  hideWelcome();
  render();
  offerWalkthrough();
}

function stepError(step, message) {
  const error = welcome.querySelector(`[data-step="${step}"] .form-error`);
  error.dataset.message = message || '';
  error.textContent = t(message);
  error.hidden = !message;
}

function passwordAuthEnabled() {
  return authMode === 'clerk' && window.KWANJA_PASSWORD_AUTH === true;
}

function updateEmailScreen(copyOnly = false) {
  const login = authIntent === 'login';
  const passwords = passwordAuthEnabled();
  const passwordLogin = login && passwords && loginMethod === 'password';
  byId('auth-heading').textContent = t(login ? 'Log in to Kwanja' : 'Create your account');
  byId('auth-description').textContent = t(passwordLogin ? 'Enter your email and password.'
    : login ? 'Use your account email to get a fresh sign-in code.' : 'We’ll send a six-digit code to verify your email.');
  byId('auth-switch-copy').textContent = t(login ? 'New to Kwanja?' : 'Already have an account?');
  const link = byId('auth-switch-link');
  link.href = login ? '#signup' : '#login';
  link.textContent = t(login ? 'Create account' : 'Log in');
  const form = welcome.querySelector('[data-form="email"]');
  const submit = form.querySelector('[type="submit"]');
  submit.textContent = t(passwordLogin ? 'Log in' : 'Send code');
  byId('password-options').querySelector('[data-action="switch-login-method"]').textContent = t(passwordLogin ? 'Use an email code' : 'Use a password');
  if (copyOnly) return;
  submit.disabled = ['pending', 'unavailable'].includes(authMode) || (apiMode && !navigator.onLine);
  const password = form.elements.password;
  byId('auth-password-field').hidden = !passwordLogin;
  password.disabled = !passwordLogin;
  password.required = passwordLogin;
  password.value = '';
  byId('password-options').hidden = !login || !passwords;
  byId('password-options').querySelector('[data-action="password-recovery"]').hidden = !passwordLogin;
  const providers = byId('auth-providers');
  providers.hidden = authMode !== 'clerk' || !configuredProviders.length;
  providers.querySelectorAll('[data-provider]').forEach((button) => { button.hidden = !configuredProviders.includes(button.dataset.provider); });
  stepError('email', apiMode && !navigator.onLine ? 'Reconnect to sign in or create an account.'
    : authMode === 'unavailable' ? 'Sign-in could not load. Try refreshing this page.' : '');
}

function publicRoute(focus = true) {
  const hash = location.hash;
  if (hash === '#signup' || hash === '#login') {
    if (authMode === 'clerk' && clerk?.session) return afterSignIn();
    authIntent = hash === '#login' ? 'login' : 'signup';
    loginMethod = 'password';
    challenge = null;
    updateEmailScreen();
    return openWelcome('email', focus);
  }
  const wasAwayFromPublicPage = welcome.hidden || !byId('auth-layout').hidden;
  openWelcome('intro', false);
  if (wasAwayFromPublicPage && focus && publicHashes.has(hash)) {
    requestAnimationFrame(() => {
      const section = byId(hash.slice(1));
      section?.scrollIntoView();
      if (hash === '#home') byId('public-title').focus({ preventScroll: true });
    });
  }
}

function clerkDomain(key) {
  try {
    const domain = atob(key.split('_').slice(2).join('_')).replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(domain) ? domain : '';
  } catch { return ''; }
}

function loadClerkScript(src, key) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    if (key) script.dataset.clerkPublishableKey = key;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load sign-in. Try again.'));
    document.head.append(script);
  });
}

async function startClerk(key) {
  const domain = clerkDomain(key);
  if (!domain) throw new Error('Sign-in is not configured correctly.');
  const sdk = !window.Clerk && loadClerkScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, key);
  const ui = window.KWANJA_PASSWORD_AUTH === true && !window.__internal_ClerkUICtor
    && loadClerkScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`).catch(() => {});
  await Promise.all([sdk, ui]);
  clerk = window.Clerk;
  const ClerkUI = window.__internal_ClerkUICtor;
  await clerk.load(ClerkUI ? { ui: { ClerkUI } } : undefined);
}

function oauthUrl() {
  return new URL(location.pathname, location.origin);
}

async function completeOAuth() {
  openWelcome('callback', false);
  const destination = oauthUrl();
  destination.hash = '#overview';
  try {
    await clerk.handleRedirectCallback({
      signInFallbackRedirectUrl: destination.href,
      signUpFallbackRedirectUrl: destination.href,
    });
  } catch (error) {
    stepError('callback', authMessage(error));
  }
}

async function startOAuth(button) {
  const provider = button.dataset.provider;
  if (authMode !== 'clerk' || !configuredProviders.includes(provider)) return;
  const callback = oauthUrl();
  callback.searchParams.set('clerk_oauth', '1');
  const destination = oauthUrl();
  destination.hash = '#overview';
  const flow = authIntent === 'login' ? clerk.client.signIn : clerk.client.signUp;
  button.disabled = true;
  stepError('email', '');
  try {
    await flow.authenticateWithRedirect({
      strategy: `oauth_${provider}`, redirectUrl: callback.href, redirectUrlComplete: destination.href,
    });
  } catch (error) {
    stepError('email', authMessage(error));
    button.disabled = false;
  }
}

async function bootApi() {
  try {
    const config = await (await api('/config')).json();
    workshopLedger = config.workshop_ledger === true;
    if (config.auth === 'demo') {
      authMode = 'demo';
      if (isWorkspaceRoute()) return finishDemo();
      return publicRoute(false);
    }
    if (config.auth !== 'clerk') throw new Error('Sign-in is not configured.');
    await startClerk(config.clerk_publishable_key);
    authMode = 'clerk';
    configuredProviders = Array.isArray(config.social_providers) ? config.social_providers : [];
  } catch {
    authMode = 'unavailable';
    return publicRoute(false);
  }
  if (oauthCallback) return completeOAuth();
  if (clerk.user && !publicHashes.has(location.hash)) return afterSignIn();
  return publicRoute(false);
}

async function afterSignIn() {
  const status = byId('connection-status');
  try {
    const me = await (await api('/me')).json();
    if (!me.business) { openWelcome('business'); return; }
    hideWelcome();
    await loadApiLedger();
  } catch (error) {
    if (authMode !== 'clerk' || !clerk?.session) return;
    hideWelcome();
    status.hidden = false;
    status.innerHTML = html`<span>${escape(t(error.message))}</span> <button class="button" type="button" data-action="retry-auth">Try again</button>`;
  }
}

async function leaveSession({ expired = false } = {}) {
  try {
    await clerk?.signOut();
  } catch {
    if (!expired) {
      notify('Could not sign out. Check your connection and try again.');
      return;
    }
  }
  entries = [];
  apiReady = false;
  byId('search').value = '';
  history.replaceState(null, '', '#home');
  render();
  openWelcome('intro');
  if (expired) notify('Your session has ended. Log in again.');
}

async function sendCode({ resource, emailAddressId, secondFactor }) {
  if (secondFactor) {
    await resource.prepareSecondFactor({ strategy: 'email_code', emailAddressId });
  } else if (emailAddressId) {
    await resource.prepareFirstFactor({ strategy: 'email_code', emailAddressId });
  } else {
    await resource.prepareEmailAddressVerification({ strategy: 'email_code' });
  }
}

async function beginEmail(email, intent) {
  let nextChallenge;
  if (intent === 'login') {
    const resource = await clerk.client.signIn.create({ identifier: email });
    const factor = resource.supportedFirstFactors?.find((item) => item.strategy === 'email_code');
    if (!factor?.emailAddressId) throw new Error('This account cannot log in with an email code.');
    nextChallenge = { resource, emailAddressId: factor.emailAddressId };
  } else {
    nextChallenge = { resource: await clerk.client.signUp.create({ emailAddress: email }) };
  }
  await sendCode(nextChallenge);
  return nextChallenge;
}

async function openClerkSignIn(email) {
  const destination = oauthUrl();
  destination.hash = '#overview';
  try {
    if (window.__internal_ClerkUICtor) {
      clerk.openSignIn({ forceRedirectUrl: destination.href, initialValues: { emailAddress: email } });
    } else {
      await clerk.redirectToSignIn({ signInFallbackRedirectUrl: destination.href });
    }
  } catch {
    stepError('email', 'Could not open Clerk sign-in. Use an email code or try again.');
  }
}

// Six-digit code entry: a real input sits invisibly over six slots, so typing, pasting and backspace all work,
// and an on-screen pad serves phones. The sixth digit submits.
const otpInput = () => welcome.querySelector('#otp-input');
let otpTimer;

function renderOtpSlots() {
  const input = otpInput();
  if (!input) return;
  const value = input.value;
  byId('otp-slots').innerHTML = Array.from({ length: 6 }, (_, index) => `<span class="${index < value.length ? 'filled' : ''}${index === value.length && document.activeElement === input ? ' current' : ''}">${index < value.length ? value[index] : ''}</span>`).join('');
}

function otpChanged() {
  const input = otpInput();
  const clean = input.value.replace(/\D/g, '').slice(0, 6);
  if (clean !== input.value) input.value = clean;
  renderOtpSlots();
  clearTimeout(otpTimer);
  if (clean.length === 6) {
    otpTimer = setTimeout(() => {
      if (!welcome.hidden && !input.closest('[data-step]').hidden && input.value.length === 6) input.form.requestSubmit();
    }, 150);
  }
}

function resetOtp(focus = true) {
  const input = otpInput();
  clearTimeout(otpTimer);
  input.value = '';
  renderOtpSlots();
  if (focus) input.focus({ preventScroll: true });
}

welcome.addEventListener('input', (event) => { if (event.target.id === 'otp-input') otpChanged(); });
welcome.addEventListener('focusin', (event) => { if (event.target.id === 'otp-input') renderOtpSlots(); });
welcome.addEventListener('focusout', (event) => { if (event.target.id === 'otp-input') renderOtpSlots(); });

function showCodeStep(email, nextChallenge) {
  challenge = nextChallenge;
  pendingEmail = email;
  byId('otp-email').textContent = email;
  byId('auth-code-heading').textContent = t(challenge?.secondFactor ? 'Verify this sign-in' : 'Check your email');
  stepError('code', '');
  markCodeSent();
  showStep('code');
  resetOtp();
}

async function loginWithPassword(email, password, stillOnForm) {
  const resource = await clerk.client.signIn.create({ identifier: email, password });
  if (!stillOnForm()) return;
  if (resource.status === 'complete') {
    await activateSession(resource);
    return;
  }
  if (resource.status === 'needs_second_factor') {
    const factor = resource.supportedSecondFactors?.find((item) => item.strategy === 'email_code');
    if (factor?.emailAddressId) {
      const nextChallenge = { resource, emailAddressId: factor.emailAddressId, secondFactor: true };
      await sendCode(nextChallenge);
      if (stillOnForm()) showCodeStep(email, nextChallenge);
      return;
    }
  }
  await openClerkSignIn(email);
}

function renderResend() {
  clearTimeout(resendTimer);
  const button = welcome.querySelector('[data-action="resend"]');
  const seconds = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
  button.disabled = seconds > 0;
  button.textContent = seconds ? t('Resend in {seconds}s', { seconds }) : t('Resend code');
  if (seconds) resendTimer = setTimeout(renderResend, 1000);
}

function markCodeSent() {
  resendUntil = authMode === 'clerk' ? Date.now() + 30000 : 0;
  renderResend();
}

async function resendCode(button) {
  if (authMode !== 'clerk') { notify('Demo mode. No email is sent.'); return; }
  if (Date.now() < resendUntil) return;
  button.disabled = true;
  stepError('code', '');
  try {
    await sendCode(challenge);
    markCodeSent();
    notify('New code requested.');
  } catch (error) {
    button.disabled = false;
    stepError('code', authMessage(error));
  }
}

async function verifyCode(code) {
  const { resource, emailAddressId, secondFactor } = challenge;
  let result;
  if (secondFactor) {
    result = await resource.attemptSecondFactor({ strategy: 'email_code', code });
  } else if (emailAddressId) {
    result = await resource.attemptFirstFactor({ strategy: 'email_code', code });
  } else {
    result = await resource.attemptEmailAddressVerification({ code });
  }
  if (result.status !== 'complete') {
    if (result.missingFields?.includes('protect_check') && clerk.redirectToSignUp) {
      notify(t('One more security check. Taking you to Clerk to finish.'));
      const destination = oauthUrl();
      destination.hash = '#overview';
      await clerk.redirectToSignUp({ signUpFallbackRedirectUrl: destination.href, signInFallbackRedirectUrl: destination.href });
      resetOtp(false);
      return;
    }
    throw new Error('Could not finish logging in. Try again.');
  }
  await activateSession(result);
}

async function activateSession(result) {
  if (!result.createdSessionId) throw new Error('Could not finish logging in. Try again.');
  await clerk.setActive({ session: result.createdSessionId });
  await afterSignIn();
}

async function openNewLedger() {
  hideWelcome();
  await loadApiLedger();
  if (apiReady) notify('Your ledger is ready.');
}

async function managePassword() {
  try {
    if (window.__internal_ClerkUICtor) clerk.openUserProfile();
    else await clerk.redirectToUserProfile();
  } catch {
    notify('Could not open account settings. Try again.');
  }
}

Object.assign(clickActions, {
  skip: finishDemo,
  'retry-auth': afterSignIn,
  signout: () => leaveSession(),
  provider: startOAuth,
  'account-security': managePassword,
  'open-ledger': openNewLedger,
  'switch-login-method': () => {
    loginMethod = loginMethod === 'password' ? 'code' : 'password';
    updateEmailScreen();
  },
  'password-recovery': () => openClerkSignIn(welcome.querySelector('[data-form="email"]').elements.email.value.trim()),
  'change-email': () => {
    challenge = null;
    welcome.querySelector('[data-form="email"] [name="email"]').value = pendingEmail;
    updateEmailScreen();
    showStep('email');
  },
  resend: resendCode,
  'otp-key': (button) => {
    const input = otpInput();
    input.value = button.dataset.key === 'del' ? input.value.slice(0, -1) : (input.value + button.dataset.key).slice(0, 6);
    otpChanged();
    input.focus({ preventScroll: true });
  },
});

welcome.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const step = form.dataset.form;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  if (submit.disabled) return;
  if (apiMode && !navigator.onLine) {
    stepError(step, 'You’re offline. Reconnect and try again.');
    return;
  }
  submit.disabled = true;
  stepError(step, '');
  try {
    if (step === 'email') {
      const email = values.email.trim();
      const screen = location.hash;
      const method = loginMethod;
      const stillOnForm = () => screen === location.hash && method === loginMethod && !form.closest('[data-step]').hidden;
      form.elements.password.value = '';
      if (passwordAuthEnabled() && authIntent === 'login' && method === 'password') {
        await loginWithPassword(email, values.password, stillOnForm);
      } else {
        const requestedCode = authMode === 'clerk' ? await beginEmail(email, authIntent) : null;
        if (stillOnForm()) showCodeStep(email, requestedCode);
      }
    } else if (step === 'code') {
      if (authMode === 'clerk') await verifyCode(values.code);
      else await finishDemo();
    } else {
      const name = values.business.trim();
      if (!name) throw new Error('Enter your business name.');
      await api('/business', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (passwordAuthEnabled() && !clerk.user?.passwordEnabled) showStep('password-setup');
      else await openNewLedger();
    }
  } catch (error) {
    stepError(step, authMessage(error));
    if (step === 'code') resetOtp();
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) clickActions[button.dataset.action](button);
});

dialog.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.busy) return;
  if (apiMode && !navigator.onLine && form.dataset.form !== 'export') {
    showError(form, 'You’re offline. Leave this form open and try again when you reconnect.');
    return;
  }
  submitActions[form.dataset.form](form, Object.fromEntries(new FormData(form)));
});

dialog.addEventListener('change', (event) => {
  const direction = event.target;
  if (direction.name !== 'direction' || direction.form.dataset.form !== 'new') return;
  const deposit = direction.form.elements.deposit;
  if (deposit) {
    deposit.disabled = direction.value === 'payable';
    deposit.closest('.field').hidden = deposit.disabled;
  }
});

dialog.addEventListener('toggle', (event) => {
  const picker = event.target;
  if (!picker.matches('.date-picker[open]')) return;
  dialogContent.querySelectorAll('.date-picker[open]').forEach((other) => {
    if (other !== picker) other.open = false;
  });
  const selected = picker.previousElementSibling.value;
  renderCalendar(picker, selected ? new Date(`${selected}T00:00:00`) : ledgerDay());
  picker.scrollIntoView({ block: 'nearest' });
}, true);

dialog.addEventListener('click', (event) => {
  const button = event.target.closest('.date-panel button');
  if (!button) return;
  const picker = button.closest('.date-picker');
  if (!button.hasAttribute('data-month')) {
    selectCalendarDate(picker, button.dataset.day ?? button.dataset.setDate);
    return;
  }
  const active = picker.querySelector('[data-day][tabindex="0"]');
  const date = new Date(`${active.dataset.day}T00:00:00`);
  date.setMonth(date.getMonth() + Number(button.dataset.month), 1);
  renderCalendar(picker, date);
  const next = picker.querySelector(`[data-month="${button.dataset.month}"]:not(:disabled)`);
  (next || picker.querySelector('[data-day][tabindex="0"]')).focus();
});

dialog.addEventListener('keydown', (event) => {
  const picker = event.target.closest('.date-picker[open]');
  if (!picker) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    picker.open = false;
    picker.querySelector('summary').focus();
    return;
  }
  const day = event.target.dataset.day;
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (!day || !offset) return;
  event.preventDefault();
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + offset);
  if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
  renderCalendar(picker, date, true);
});

dialog.addEventListener('cancel', (event) => {
  if (dialog.querySelector('form[data-busy]')) event.preventDefault();
});

dialog.addEventListener('close', () => {
  stagedImport = '';
  if (dialogContent.querySelector('.walkthrough')) rememberWalkthrough();
  const entryId = returnFocus?.dataset.entry;
  const replacement = entryId && [...byId(`${route().page}-view`).querySelectorAll('[data-entry]')].find((element) => element.dataset.entry === entryId);
  (returnFocus?.isConnected ? returnFocus : replacement || byId('main')).focus();
});

function renderPrivacy() {
  const hidden = document.documentElement.classList.contains('hide-amounts');
  const label = t(hidden ? 'Show amounts' : 'Hide amounts');
  document.querySelectorAll('[data-action="privacy"]').forEach((button) => {
    button.setAttribute('aria-pressed', String(hidden));
    button.setAttribute('aria-label', label);
    const icon = button.querySelector('use');
    if (icon) icon.setAttribute('href', hidden ? '#i-eyeoff' : '#i-eye');
    else button.textContent = label;
  });
}

function togglePrivacy() {
  const hidden = document.documentElement.classList.toggle('hide-amounts');
  renderPrivacy();
  try { localStorage.setItem('kwanja-hide-amounts', hidden ? '1' : '0'); } catch { /* storage unavailable */ }
}

try {
  document.documentElement.classList.toggle('hide-amounts', localStorage.getItem('kwanja-hide-amounts') === '1');
} catch { /* storage unavailable */ }
renderPrivacy();

document.querySelectorAll('[data-language]').forEach((select) => {
  select.addEventListener('change', () => {
    language.change(select.value);
    updateDateFormats();
    renderPrivacy();
    render();
    renderRepairDemo();
    updateEmailScreen(true);
    byId('auth-code-heading').textContent = t(challenge?.secondFactor ? 'Verify this sign-in' : 'Check your email');
    renderResend();
    welcome.querySelectorAll('.form-error[data-message]').forEach((message) => {
      message.textContent = t(message.dataset.message);
    });
  });
});

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  const target = welcome.hidden ? byId('main') : byId('public-main');
  if (!target.closest('[hidden]')) {
    target.focus();
    target.scrollIntoView();
  } else {
    welcome.querySelector('[data-step]:not([hidden]) h1')?.focus();
  }
});
byId('search').addEventListener('input', renderLedger);
byId('ledger-search').addEventListener('submit', (event) => {
  event.preventDefault();
  const matches = byId('ledger-list').querySelectorAll('.search-results [data-entry]');
  if (matches.length === 1) matches[0].click();
});
window.addEventListener('hashchange', () => {
  if (publicHashes.has(location.hash) || ['#signup', '#login'].includes(location.hash) || !welcome.hidden) {
    publicRoute();
    return;
  }
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('storage', (event) => {
  if (apiMode || event.key !== storageKey) return;
  if (dialog.open) dialog.close();
  entries = readLedger();
  render();
});

if (pwaEnabled) {
  const workerUrl = new URL('service-worker.js', document.currentScript.src);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    showInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showInstallButtons(true);
  });
  showInstallButtons();
  if (navigator.onLine) navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' }).catch(() => {});
}
window.addEventListener('offline', updateOfflineStatus);
window.addEventListener('online', () => {
  updateOfflineStatus();
  if (apiMode && authMode === 'unavailable') bootApi();
});
const launchUrl = new URL(location.href);
if (pwaEnabled && navigator.onLine && !byId('settings-view') && launchUrl.searchParams.get('kwanja-refresh') !== 'preferences') {
  // Give a stale installed page one fresh navigation without losing its route.
  launchUrl.searchParams.set('kwanja-refresh', 'preferences');
  location.replace(launchUrl);
} else {
  updateOfflineStatus();
  render();
  publicRoute(false);
  if (apiMode) {
    bootApi();
  } else if (isWorkspaceRoute()) {
    try { if (localStorage.getItem(onboardedKey)) finishDemo(); } catch { /* storage unavailable */ }
  }
}
