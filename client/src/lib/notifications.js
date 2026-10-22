export const NOTIFICATION_STATUS = {
  QUEUED: { label: 'Queued', tone: 'neutral', help: 'Waiting to be sent or retried.' },
  SENT: { label: 'Sent', tone: 'ok', help: 'Accepted by the mail server. Plain SMTP cannot confirm the recipient opened it.' },
  DELIVERED: { label: 'Delivered', tone: 'ok', help: 'Delivery confirmed by the provider.' },
  FAILED: { label: 'Failed', tone: 'bad', help: 'Gave up after repeated attempts. Check the error, then retry.' },
};

export const NOTIFICATION_TYPES = {
  D1_ACKNOWLEDGEMENT: 'D1 acknowledgement',
  D2_FRP_ASSIGNED: 'FRP assigned',
  D2_COMPLETED: 'D2 completed',
  D3_APPROVAL_REQUEST: 'D3 approval request',
  D3_REJECTED: 'D3 rejected',
  D4_NOTICE: 'D4 notice',
  CLOSURE: 'Closure',
  WHATSAPP_COMPLAINT_REGISTERED: 'WhatsApp: registered',
  WHATSAPP_STATUS_UPDATE: 'WhatsApp: status update',
};
