'use strict';

const byId = (id) => document.getElementById(id);
const storageKey = 'kwanja-demo-ledger';
// config.js sets window.KWANJA_API: '' = same origin as the page, 'https://api.example.com' = a separate API origin, null = offline demo.
const apiBase = window.KWANJA_API === undefined ? '' : window.KWANJA_API;
const apiMode = apiBase !== null && (location.protocol === 'http:' || location.protocol === 'https:');
const demoBusiness = 'Wanjiru Traders';
const nairobiDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' });
const numberFormat = new Intl.NumberFormat('en-KE');
const decimalFormat = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const directions = { receivable: 'Owed to you', payable: 'You owe' };
const pageTitles = { overview: 'Overview', ledger: 'Ledger', contacts: 'Contacts' };
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
  return `${year}-${month}-${day}`;
}

function daysFromToday(days) {
  const date = ledgerDay();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function monthDate(monthsBack, day = 1) {
  const date = ledgerDay();
  const dayThisMonth = Math.min(day, date.getDate());
  return new Date(date.getFullYear(), date.getMonth() - monthsBack, monthsBack === 0 ? dayThisMonth : day);
}

function displayDate(value) {
  return dateFormat.format(new Date(`${value}T00:00:00`));
}

function formatAmount(cents) {
  return (cents % 100 === 0 ? numberFormat : decimalFormat).format(cents / 100).replace(/^-/, '−');
}

const money = (cents) => `KES\u00a0${formatAmount(cents)}`;
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const paidTotal = (entry) => entry.payments.reduce((sum, payment) => sum + payment.cents, 0);
const outstanding = (entry) => entry.cents - paidTotal(entry);
const isOverdue = (entry) => Boolean(entry.due && entry.due < localDate() && outstanding(entry) > 0);
const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
const empty = (message) => `<p class="empty">${message}</p>`;
const emptyLedger = () => `<div class="empty-state"><span class="coin" aria-hidden="true">${icon('ledger')}</span><strong>Your ledger is empty</strong>
  <p>Record who owes you, and who you owe. Reminders and payments come next.</p>
  <button class="button primary" type="button" data-action="new">Add your first debt</button></div>`;

function seedLedger() {
  const payments = [4300, 7800, 5400, 11200, 8300, 14900].map((amount, index) => ({
    cents: amount * 100, date: localDate(monthDate(5 - index, 2)), reference: '',
  }));

  return [
    { id: 'njeri', contact: 'Mama Njeri', note: 'Unga and sukari', direction: 'receivable', cents: 620000, due: daysFromToday(-2), date: daysFromToday(-5), payments: [] },
    { id: 'kamau', contact: 'Kamau Hardware', note: 'Cement and fittings', direction: 'receivable', cents: 3340000, due: daysFromToday(7), date: daysFromToday(-7), payments: [{ cents: 500000, date: daysFromToday(-4), reference: '' }] },
    { id: 'baraka', contact: 'Baraka Wholesalers', note: 'Shop stock', direction: 'payable', cents: 1840000, due: daysFromToday(4), date: daysFromToday(-9), payments: [] },
    { id: 'pendo', contact: 'Salon Pendo', note: 'Salon supplies', direction: 'receivable', cents: 1370000, due: daysFromToday(-5), date: daysFromToday(-10), payments: [] },
    { id: 'amani', contact: 'Amani Stores', note: 'Opening balance', direction: 'receivable', cents: 5190000, due: '', date: localDate(monthDate(5)), payments },
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
let businessName = demoBusiness;
let apiReady = !apiMode;
let toastTimeout;
let activeEntry;
let returnFocus;
const dialog = byId('dialog');
const dialogContent = byId('dialog-content');

function notify(message) {
  clearTimeout(toastTimeout);
  byId('toast').textContent = message;
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
  status.textContent = 'Loading ledger…';
  document.querySelectorAll('[data-action="new"], [data-action="export"]').forEach((button) => { button.disabled = true; });
  try {
    const [business, debts] = await Promise.all(['/business', '/entries'].map(async (path) => (await api(path)).json()));
    businessName = business.name;
    entries = debts;
    apiReady = true;
    status.hidden = true;
    document.querySelectorAll('[data-action="new"], [data-action="export"]').forEach((button) => { button.disabled = false; });
  } catch {
    status.innerHTML = 'Could not connect to the ledger. <button class="button" type="button" data-action="retry">Try again</button>';
  }
  render();
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
  const buttons = [...form.querySelectorAll('button'), dialog.querySelector('[data-action="close"]')];
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
  return `<span class="contact-avatar avatar-${color}" aria-hidden="true">${escape(initials)}</span>`;
}

function entryStatus(entry) {
  if (!outstanding(entry)) return { text: 'Settled', color: 'paid' };
  if (isOverdue(entry)) return { text: `Overdue · ${displayDate(entry.due)}`, color: 'overdue' };
  if (entry.due) return { text: `Due ${displayDate(entry.due)}`, color: '' };
  return { text: 'Open', color: '' };
}

const signed = (entry) => (!outstanding(entry) ? money(entry.cents) : `${entry.direction === 'payable' ? '\u2212' : '+'}${money(outstanding(entry))}`);

function entryRow(entry, compact = false) {
  const status = entryStatus(entry);
  return `<button class="entry-row${compact === true ? ' compact' : ''}" type="button" data-action="detail" data-direction="${entry.direction}" data-settled="${!outstanding(entry)}" data-entry="${escape(entry.id)}">
    ${compact === true ? '' : avatar(entry.contact)}
    <span class="row-main"><strong>${escape(compact === true ? (entry.note || directions[entry.direction]) : entry.contact)}</strong><small>${compact === true ? `${directions[entry.direction]} · added ${displayDate(entry.date)}` : escape(entry.note || directions[entry.direction])}</small></span>
    <span class="row-side"><strong class="row-amount"><span class="sr-only">${directions[entry.direction]}, </span>${signed(entry)}</strong>
    <small class="row-status ${status.color}">${status.text}</small></span>
  </button>`;
}

function entryCard(entry) {
  const status = entryStatus(entry);
  const settled = !outstanding(entry);
  return `<button class="debt-card ${settled ? 'settled' : entry.direction}" type="button" data-action="detail" data-direction="${entry.direction}" data-entry="${escape(entry.id)}">
    <span class="dc-top"><strong class="dc-name">${escape(entry.contact)}</strong><span class="dc-chip ${status.color}">${status.text}</span></span>
    <span class="dc-amount"><span class="sr-only">${directions[entry.direction]}, </span>${money(settled ? entry.cents : outstanding(entry))}</span>
    <span class="dc-foot"><span>${escape(entry.note || directions[entry.direction])}</span><span>${directions[entry.direction]}</span></span>
    <span class="dc-mark" aria-hidden="true">Kwanja</span>
  </button>`;
}

function sortedEntries() {
  return [...entries].sort((left, right) => right.date.localeCompare(left.date));
}

function renderOverview() {
  const open = entries.filter((entry) => outstanding(entry) > 0);
  const receivable = open.filter((entry) => entry.direction === 'receivable');
  const payable = open.filter((entry) => entry.direction === 'payable');
  const receiveTotal = receivable.reduce((sum, entry) => sum + outstanding(entry), 0);
  const payTotal = payable.reduce((sum, entry) => sum + outstanding(entry), 0);
  const overdue = receivable.filter(isOverdue).sort((a, b) => a.due.localeCompare(b.due));
  const overdueTotal = overdue.reduce((sum, entry) => sum + outstanding(entry), 0);

  byId('net-amount').textContent = formatAmount(receiveTotal - payTotal);
  byId('overdue-chip').innerHTML = overdueTotal ? `Overdue <b>${money(overdueTotal)}</b>` : 'Nothing <b>overdue</b>';
  byId('receivable-total').textContent = money(receiveTotal);
  byId('payable-total').textContent = money(payTotal);
  byId('receivable-count').textContent = plural(receivable.length, 'open debt');
  byId('payable-count').textContent = plural(payable.length, 'open bill');

  byId('follow-section').hidden = !entries.length;
  byId('recent-section').hidden = !entries.length;
  const first = overdue[0];
  byId('banner').innerHTML = !entries.length
    ? `<div class="banner-copy"><strong>Start your ledger</strong><p>Add the first person who owes you, then remind them in one tap.</p></div><button class="coin" type="button" data-action="new" aria-label="Add your first debt">${icon('plus')}</button>`
    : first
    ? `<div class="banner-copy"><strong>${plural(overdue.length, 'customer')} overdue</strong><p>${money(overdueTotal)} is past due. Start with ${escape(first.contact)}.</p></div>
       <button class="coin" type="button" data-action="remind" data-entry="${escape(first.id)}" aria-label="Send WhatsApp reminder to ${escape(first.contact)}">${icon('whatsapp')}</button>`
    : `<div class="banner-copy"><strong>All caught up</strong><p>Nobody owes you past their due date.</p></div><span class="coin" aria-hidden="true">${icon('check')}</span>`;

  const chase = [...open].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  byId('follow-list').innerHTML = chase.map((entry) => `<button class="chase" type="button" data-action="detail" data-entry="${escape(entry.id)}" data-direction="${entry.direction}">
    <span class="chase-face">${avatar(entry.contact)}<span class="chase-badge ${entry.direction}" aria-hidden="true">${icon(entry.direction === 'receivable' ? 'in' : 'out')}</span></span>
    <span class="chase-name">${escape(entry.contact.split(/\s+/)[0])}</span></button>`).join('') || empty('Nothing open yet.');
  byId('recent-list').innerHTML = sortedEntries().slice(0, 4).map(entryRow).join('') || empty('Nothing here yet.');
}

function route() {
  const [page, filter] = location.hash.slice(1).split('/');
  const selectedFilter = ['receivable', 'payable', 'paid'].includes(filter) ? filter : 'all';
  return { page: Object.hasOwn(pageTitles, page) ? page : 'overview', filter: selectedFilter };
}

function renderLedger() {
  const { filter } = route();
  const query = byId('search').value.trim().toLocaleLowerCase();
  const rows = sortedEntries().filter((entry) => {
    const matchesFilter = filter === 'all' || (filter === 'paid' ? !outstanding(entry) : filter === entry.direction && outstanding(entry) > 0);
    return matchesFilter && `${entry.contact} ${entry.note}`.toLocaleLowerCase().includes(query);
  });

  document.querySelectorAll('[data-filter]').forEach((link) => {
    if (link.dataset.filter === filter) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });

  const owedTo = rows.filter((entry) => entry.direction === 'receivable').reduce((sum, entry) => sum + outstanding(entry), 0);
  const owe = rows.filter((entry) => entry.direction === 'payable').reduce((sum, entry) => sum + outstanding(entry), 0);
  byId('ledger-sub').textContent = [plural(rows.length, 'entry', 'entries'), owedTo ? `${money(owedTo)} owed to you` : '', owe ? `${money(owe)} you owe` : ''].filter(Boolean).join(' · ');
  byId('ledger-list').innerHTML = rows.map(entryCard).join('') || (entries.length ? empty(query ? 'No entries match your search.' : 'No entries in this view.') : emptyLedger());
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
      const amount = net === 0 ? 'Settled' : `${net > 0 ? '+' : '\u2212'}${money(Math.abs(net))}`;
      return `<section class="contact-group"><header class="cg-head">${avatar(contactEntries[0].contact)}
        <span class="row-main"><h2>${escape(contactEntries[0].contact)}</h2><small>${open ? plural(open, 'open entry', 'open entries') : 'All settled'}</small></span>
        <strong class="cg-net ${tone}">${amount}</strong></header>
        ${contactEntries.map((entry) => entryRow(entry, true)).join('')}</section>`;
    })
    .join('') || empty('Add a debt to add your first contact.');
}

function render() {
  const { page } = route();
  for (const name of Object.keys(pageTitles)) byId(`${name}-view`).hidden = !apiReady || name !== page;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  byId('account').hidden = authMode !== 'clerk' || !clerk?.user;
  if (!byId('account').hidden) byId('account-email').textContent = clerk.user.primaryEmailAddress?.emailAddress || '';
  byId('account').querySelector('[data-action="account-security"]').hidden = !passwordAuthEnabled();
  byId('page-title').textContent = pageTitles[page];
  byId('page-context').textContent = page === 'overview' && authMode !== 'clerk' ? `${businessName} · Demo workspace` : businessName;
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
}

function field(label, control, help = '') {
  return `<label class="field"><span>${label}</span>${control}${help ? `<small>${help}</small>` : ''}</label>`;
}

function showNew() {
  const names = [...new Set(entries.map((entry) => entry.contact))];
  showDialog('Add debt', `<form class="form" data-form="new">
    <div class="segment" role="radiogroup" aria-label="Direction">
      <label><input type="radio" name="direction" value="receivable" checked><span>Owed to you</span></label>
      <label><input type="radio" name="direction" value="payable"><span>You owe</span></label>
    </div>
    ${field('Contact', '<input name="contact" maxlength="80" list="contact-names" placeholder="Customer or supplier name" required>')}
    <datalist id="contact-names">${names.map((name) => `<option value="${escape(name)}"></option>`).join('')}</datalist>
    ${field('Amount (KES)', '<input class="big" name="amount" type="number" inputmode="decimal" min="0.01" max="1000000000" step="0.01" placeholder="0" required>')}
    <div class="field-grid">
      ${field('Due date', '<input type="date" name="due">')}
      ${field('Note', '<input name="note" maxlength="120" placeholder="Optional">')}
    </div>
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Save debt</button></div>
  </form>`, '[name=contact]');
}

function showDetail(entry) {
  activeEntry = entry;
  const balance = outstanding(entry);
  const status = entryStatus(entry);
  const actions = balance > 0 ? `<div class="detail-actions">
    <button class="button primary" type="button" data-action="payment">Record payment</button>
    ${entry.direction === 'receivable' ? `<button class="button" type="button" data-action="reminder">${icon('whatsapp').replace('class="icon"', 'class="icon wa"')} WhatsApp reminder</button>` : ''}
  </div>` : '';
  const history = [...entry.payments].reverse().map((payment) => `<li>
    <span>${displayDate(payment.date)}${payment.reference ? ` · ${escape(payment.reference)}` : ''}</span><strong>${money(payment.cents)}</strong>
  </li>`).join('');
  showDialog(entry.contact, `<div class="detail-summary ${balance ? entry.direction : 'settled'}"><p>${directions[entry.direction]} · ${status.text}</p>
    <strong class="detail-amount">${money(balance)}</strong><p>Original amount ${money(entry.cents)}</p></div>
    <p class="detail-meta">Added ${displayDate(entry.date)}${entry.note ? ` · ${escape(entry.note)}` : ''}</p>
    ${actions}
    <section class="detail-history"><h3>Payment history</h3>${history ? `<ul>${history}</ul>` : '<p class="help">No payments recorded yet.</p>'}</section>`);
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
  showDialog('Record payment', `<form class="form pay" data-form="payment">
    <div class="pay-to">${avatar(entry.contact)}<span><strong>${escape(entry.contact)}</strong><small>${directions[entry.direction]} · ${money(remaining)} remaining</small></span></div>
    <input type="hidden" name="amount" value="${escape(String(amount))}">
    <output class="pay-amount${amount ? '' : ' empty-amount'}" aria-live="polite"><span>KES</span><b>${digitsLabel(amount)}</b></output>
    <div class="chips">${chips.map(([label, cents]) => `<button type="button" data-action="chip" data-amount="${cents / 100}">${label}</button>`).join('')}</div>
    <div class="numpad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((key) => `<button type="button" data-action="key" data-key="${key}">${key}</button>`).join('')}<button type="button" data-action="key" data-key="del" aria-label="Delete last digit"><svg class="icon"><use href="#i-back"/></svg></button></div>
    <details class="ref"><summary>Add M-Pesa reference</summary>${field('Reference', `<input name="reference" maxlength="40" value="${escape(reference)}" placeholder="e.g. confirmation code">`)}</details>
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Record payment</button>
    <div class="pair"><button class="button" type="button" data-action="sms"><img class="brand-mark" src="brands/mpesa.svg" alt="">Paste M-Pesa SMS</button>
    <button class="button" type="button" data-action="back">Back</button></div></div>
  </form>`);
}

function showSms() {
  showDialog('Paste M-Pesa SMS', `<form class="form" data-form="sms">
    ${field('Confirmation message', '<textarea name="sms" rows="4" maxlength="1500" required></textarea>', 'Review the amount before saving. Kwanja saves the payment details only.')}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Review payment</button>
    <button class="button" type="button" data-action="payment">Back</button></div>
  </form>`, '[name=sms]');
}

function showReminder() {
  const entry = activeEntry;
  const greeting = `Hi ${entry.contact}, a quick reminder that ${money(outstanding(entry))} is outstanding with ${businessName}.`;
  const due = entry.due ? ` The agreed due date was ${displayDate(entry.due)}.` : '';
  const message = `${greeting}${isOverdue(entry) ? due : ''} Please let us know when you can pay. Thank you!`;
  showDialog('WhatsApp reminder', `<form class="form" data-form="reminder">
    ${field('Kenyan mobile number', '<input type="tel" name="phone" placeholder="e.g. 07XX XXX XXX" maxlength="24" required>', 'WhatsApp opens with a draft for you to review and send.')}
    ${field('Message', `<textarea name="message" rows="5" maxlength="700" required>${escape(message)}</textarea>`)}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="button primary" type="submit">Open WhatsApp</button>
    <button class="button" type="button" data-action="copy">Copy message</button>
    <button class="button" type="button" data-action="back">Back</button></div>
  </form>`, '[name=phone]');
}

function showError(form, message) {
  const error = form.querySelector('.form-error');
  error.textContent = message;
  error.classList.remove('success');
  error.hidden = false;
}

function amountToCents(amount) {
  return /^\d+(?:\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
}

async function submitNew(form, values) {
  const cents = amountToCents(values.amount);
  const contact = values.contact.trim();
  if (!contact || !cents) {
    showError(form, 'Enter a contact and a positive amount with up to two decimal places.');
    return;
  }
  if (apiMode) {
    const saved = await submitToApi(form, '/entries', {
      contact, direction: values.direction, cents, due: values.due || null, note: values.note.trim(),
    });
    if (!saved) return;
    saveLedger([saved, ...entries.filter((entry) => entry.id !== saved.id)], 'Debt added.');
    dialog.close();
    return;
  }
  const existing = entries.find((entry) => entry.contact.toLocaleLowerCase() === contact.toLocaleLowerCase());
  const id = globalThis.crypto?.randomUUID?.() ?? `debt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entry = { id, contact: existing?.contact || contact, direction: values.direction, cents, note: values.note.trim(), date: localDate(), due: values.due, payments: [] };
  saveLedger([entry, ...entries], 'Debt added.');
  dialog.close();
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
  const digits = values.phone.replace(/[\s()+-]/g, '');
  const phone = digits.replace(/^0(?=[17])/, '254').replace(/^(?=[17]\d{8}$)/, '254');
  if (!/^254[17]\d{8}$/.test(phone)) {
    showError(form, 'Enter a Kenyan mobile number beginning with 07, 01 or +254.');
    return;
  }
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(values.message)}`, '_blank', 'noopener,noreferrer');
}

async function exportLedger() {
  if (apiMode) {
    try {
      downloadCsv(await (await api('/export.csv')).blob());
    } catch {
      notify('Could not export the ledger. Try again.');
    }
    return;
  }
  const csvCell = (value) => {
    const text = String(value);
    const safeText = typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  };
  const rows = sortedEntries().map((entry) => [
    entry.contact, directions[entry.direction], entry.note, entry.date, entry.due,
    entry.cents / 100, paidTotal(entry) / 100, outstanding(entry) / 100,
  ]);
  rows.unshift(['Contact', 'Direction', 'Note', 'Date added', 'Due date', 'Original (KES)', 'Paid (KES)', 'Outstanding (KES)']);
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadCsv(blob);
}

function downloadCsv(blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kwanja-ledger-${localDate()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  notify('Ledger exported.');
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
  new: showNew,
  retry: loadApiLedger,
  export: exportLedger,
  close: () => dialog.close(),
  detail: (button) => showDetail(entries.find((entry) => entry.id === button.dataset.entry)),
  payment: () => showPayment(),
  reminder: showReminder,
  sms: showSms,
  back: () => showDetail(activeEntry),
  copy: copyReminder,
  privacy: togglePrivacy,
  key: pressKey,
  chip: (button) => setPayAmount(button.dataset.amount),
  remind: (button) => { activeEntry = entries.find((entry) => entry.id === button.dataset.entry); showReminder(); },
};
const submitActions = { new: submitNew, payment: submitPayment, sms: submitSms, reminder: submitReminder };

/* The public website and account setup use the same entry point as the ledger. */
const onboardedKey = 'kwanja-onboarded';
const welcome = byId('welcome');
const publicHashes = new Set(['#home', '#welcome', '#how-it-works', '#about', '#questions']);
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
}

function stepError(step, message) {
  const error = welcome.querySelector(`[data-step="${step}"] .form-error`);
  error.textContent = message;
  error.hidden = !message;
}

function passwordAuthEnabled() {
  return authMode === 'clerk' && window.KWANJA_PASSWORD_AUTH === true;
}

function updateEmailScreen() {
  const login = authIntent === 'login';
  const passwords = passwordAuthEnabled();
  const passwordLogin = login && passwords && loginMethod === 'password';
  byId('auth-heading').textContent = login ? 'Log in to Kwanja' : 'Create your account';
  byId('auth-description').textContent = passwordLogin ? 'Enter your email and password.'
    : login ? 'Use your account email to get a fresh sign-in code.' : 'We’ll send a six-digit code to verify your email.';
  byId('auth-switch-copy').textContent = login ? 'New to Kwanja?' : 'Already have an account?';
  const link = byId('auth-switch-link');
  link.href = login ? '#signup' : '#login';
  link.textContent = login ? 'Create account' : 'Log in';
  const form = welcome.querySelector('[data-form="email"]');
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = ['pending', 'unavailable'].includes(authMode);
  submit.textContent = passwordLogin ? 'Log in' : 'Send code';
  const password = form.elements.password;
  byId('auth-password-field').hidden = !passwordLogin;
  password.disabled = !passwordLogin;
  password.required = passwordLogin;
  password.value = '';
  byId('password-options').hidden = !login || !passwords;
  byId('password-options').querySelector('[data-action="switch-login-method"]').textContent =
    passwordLogin ? 'Use an email code' : 'Use a password';
  byId('password-options').querySelector('[data-action="password-recovery"]').hidden = !passwordLogin;
  const providers = byId('auth-providers');
  providers.hidden = authMode !== 'clerk' || !configuredProviders.length;
  providers.querySelectorAll('[data-provider]').forEach((button) => { button.hidden = !configuredProviders.includes(button.dataset.provider); });
  stepError('email', authMode === 'unavailable' ? 'Sign-in could not load. Try refreshing this page.' : '');
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

async function startClerk(key) {
  if (!window.Clerk) {
    const domain = clerkDomain(key);
    if (!domain) throw new Error('Sign-in is not configured correctly.');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
      script.dataset.clerkPublishableKey = key;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load sign-in. Try again.'));
      document.head.append(script);
    });
  }
  clerk = window.Clerk;
  await clerk.load();
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
    if (config.auth === 'demo') {
      authMode = 'demo';
      if (/^#(overview|ledger|contacts)(\/|$)/.test(location.hash)) return finishDemo();
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
    status.innerHTML = `${escape(error.message)} <button class="button" type="button" data-action="retry-auth">Try again</button>`;
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
  history.replaceState(null, '', '#home');
  render();
  openWelcome('intro');
  if (expired) notify('Your session has ended. Log in again.');
}

async function sendCode({ resource, emailAddressId, secondFactor }) {
  if (secondFactor) {
    await resource.prepareSecondFactor({ strategy: 'email_code', emailAddressId });
  } else if (emailAddressId) {
    await resource.prepareFirstFactorVerification({ strategy: 'email_code', emailAddressId });
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

function openClerkSignIn(email) {
  const destination = oauthUrl();
  destination.hash = '#overview';
  clerk.openSignIn({ forceRedirectUrl: destination.href, initialValues: { emailAddress: email } });
}

function showCodeStep(email, nextChallenge) {
  challenge = nextChallenge;
  pendingEmail = email;
  byId('otp-email').textContent = email;
  byId('auth-code-heading').textContent = challenge?.secondFactor ? 'Verify this sign-in' : 'Check your email';
  welcome.querySelector('[name="code"]').value = '';
  stepError('code', '');
  markCodeSent();
  showStep('code');
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
  openClerkSignIn(email);
}

function renderResend() {
  clearTimeout(resendTimer);
  const button = welcome.querySelector('[data-action="resend"]');
  const seconds = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
  button.disabled = seconds > 0;
  button.textContent = seconds ? `Resend in ${seconds}s` : 'Resend code';
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
    result = await resource.attemptFirstFactorVerification({ strategy: 'email_code', code });
  } else {
    result = await resource.attemptEmailAddressVerification({ code });
  }
  if (result.status !== 'complete') {
    if (result.missingFields?.includes('protect_check') && clerk.redirectToSignUp) {
      const destination = oauthUrl();
      destination.hash = '#overview';
      await clerk.redirectToSignUp({ signUpFallbackRedirectUrl: destination.href, signInFallbackRedirectUrl: destination.href });
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

Object.assign(clickActions, {
  skip: finishDemo,
  'retry-auth': afterSignIn,
  signout: () => leaveSession(),
  provider: startOAuth,
  'account-security': () => clerk.openUserProfile(),
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
});

welcome.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const step = form.dataset.form;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  if (submit.disabled) return;
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
    if (step === 'code') welcome.querySelector('[name="code"]').select();
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
  if (!form.dataset.busy) submitActions[form.dataset.form](form, Object.fromEntries(new FormData(form)));
});

dialog.addEventListener('cancel', (event) => {
  if (dialog.querySelector('form[data-busy]')) event.preventDefault();
});

dialog.addEventListener('close', () => {
  const entryId = returnFocus?.dataset.entry;
  const replacement = entryId && [...byId(`${route().page}-view`).querySelectorAll('[data-entry]')].find((element) => element.dataset.entry === entryId);
  (returnFocus?.isConnected ? returnFocus : replacement || document.querySelector('.pill-dark')).focus();
});

function togglePrivacy(button) {
  const hidden = document.documentElement.classList.toggle('hide-amounts');
  button.setAttribute('aria-pressed', String(hidden));
  button.setAttribute('aria-label', hidden ? 'Show amounts' : 'Hide amounts');
  button.querySelector('use').setAttribute('href', hidden ? '#i-eyeoff' : '#i-eye');
  try { localStorage.setItem('kwanja-hide-amounts', hidden ? '1' : '0'); } catch { /* storage unavailable */ }
}

try {
  if (localStorage.getItem('kwanja-hide-amounts') === '1') togglePrivacy(document.querySelector('[data-action="privacy"]'));
} catch { /* storage unavailable */ }

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

render();
publicRoute(false);
if (apiMode) {
  bootApi();
} else if (/^#(overview|ledger|contacts)(\/|$)/.test(location.hash)) {
  try { if (localStorage.getItem(onboardedKey)) finishDemo(); } catch { /* storage unavailable */ }
}
