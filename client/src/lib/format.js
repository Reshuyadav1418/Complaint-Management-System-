const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });

export const formatDateTime = (v) => (v ? dateTime.format(new Date(v)) : '—');
export const formatDate = (v) => (v ? dateOnly.format(new Date(v)) : '—');
