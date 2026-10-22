# Open business questions

These need an answer from the business before the phase listed. Where the build needed a value to proceed, the placeholder chosen is stated. Each placeholder is in one place in the code and is easy to change.

The reference screenshots of the current system were not supplied. Many of these questions could be answered quickly from those screenshots, or from an export of the current Salesforce objects.

## Before Phase 3 (complaint registration)

**Q1. Complaint number format.** What is the approved format, and does it reset each year, each SBU or never?
*Placeholder:* `CMP-2026-000001`, reset each calendar year in IST. The prefix and padding are environment variables; the pattern is in `services/sequenceService.js`.

**Q2. Mandatory fields at registration.** Which D1 fields are mandatory for WhatsApp submissions and which for staff-entered complaints?
*Placeholder:* requester name, SBU, country and short description are required. Email is validated when given.

**Q2a. Acknowledging without an email.** Phone and walk-in complaints may have no email address. Should acknowledgement then be allowed, and the confirmation sent by WhatsApp or SMS instead?
*Current behaviour:* approval is blocked until an email is added to D1.

**Q2b. D1 → D2.** After acknowledgement, does the complaint move to D2 automatically, or does a person start D2?
*Current behaviour:* a separate "Start D2" step, switched on in Phase 5.

**Q3. Status names.** What are the company's status names, and how do they map to the proposed internal states in `config/workflow.js`? For example, is there a separate "D1 acknowledgement pending" after "Submitted", or are they the same state?

**Q4. Visibility.** Should a Quality Coordinator see every complaint, or only those for their SBU or country? Should FRPs see only complaints assigned to them? The current default is yes to both. Restricting by SBU or country would add a scope field to users.

## Before Phase 5 (D2)

**Q5. RPN rule.** The existing screen shows RPN as a calculated value. What is the formula: A × B × C, or something else? What are the score scales for occurrences, affected quantity and severity, and what does each score mean?
*Current behaviour:* RPN is entered by hand and stored as a number. Once the rule is known it will be calculated automatically and the field made read-only.

**Q6. D2 option lists.** What are the values for Performance/Efficacy, Manufacturing Location, Location Detail (and which details belong to which location), Type of Failure, SBU, Complaint Head Quarter and complaint category? Who maintains these lists, and do they change often enough to need an admin screen?

**Q6a. SLA defaults.** Are the D3 and D4 SLA hours entered for each complaint or derived from RPN or priority? Is the SLA clock in calendar hours or business hours, and is there an escalation contact?

**Q6b. Who receives the D2 completion notice?**
*Current behaviour:* the assigned FRP. Set `D2_COMPLETED_NOTIFY` to a comma-separated list of `frp`, `completer` and/or email addresses to change it.

**Q6c. Which D2 fields are mandatory before completing D2?**
*Placeholder:* verified batch number, manufacturing location, type of failure and severity score (`D2_REQUIRED` in `services/workflowService.js`).

**Q6d. Who may be FRP, and when is a complaint urgent?**
*Current behaviour:* any active user whose role can record D3 analysis may be chosen; administrators qualify too, because they hold every permission. The urgency line appears for High and Critical priority. Should the previous FRP be emailed when a complaint is reassigned?

## Before Phase 6–7 (D3)

**Q7. Fishbone categories.** Confirm the six categories: Manpower, Method, Machine, Material, Measurement, Mother Nature. Does the existing system use "Environment" instead of "Mother Nature"?

**Q8. D3 methods.** Can an investigation use both Why-Why and Fishbone, or exactly one? Is a minimum number of "why" levels required?
*Placeholder:* the schema allows both.

**Q8a. Root cause and CAPA rules.** Which columns are mandatory before submission? Is CAPA required for every root cause, and what are the CAPA categories? Is a preventive action always required alongside a corrective action?

**Q8b. Reviewer selection.** Is the D3 reviewer the FRP's line manager (which would need a manager field on users), a fixed person per department, or chosen at submission?
*Current behaviour:* the FRP chooses at submission from users whose role can review D3. An administrator can decide if the reviewer is unavailable. Nobody can decide on their own submission.

**Q8c. Rework limits.** Can a submission be rejected any number of times? Does rejection notify only the FRP, or the Quality Coordinator as well?
*Current behaviour:* no limit; one rejection email per CAPA to the FRP. Should the FRP also be emailed when the analysis is approved? The brief lists no approval email, so none is sent.

## Before Phase 8 (D4 and closure)

**Q9.** What happens in D4: action verification, effectiveness check, or customer communication?

**Q10.** Who works on D4, and who approves its completion?

**Q11.** What evidence is mandatory before closure?

**Q12.** What are the exact conditions for "Closed"? Is a closure email sent to the reporter, and does it go by email, WhatsApp or both?

## Integrations (Phase 4 and Phase 9)

**Q13. Email.** Which SMTP server and sender address are approved? Does the provider supply delivery events? Without them, email can only be shown as "sent", never "delivered".

**Q14. WhatsApp.** Is there a WhatsApp Business account, phone number ID and approved message templates? Template approval by Meta takes time, so it is worth starting early.

**Q14a. WhatsApp templates.** Status updates sent more than 24 hours after the customer's last message need Meta-approved templates. Which updates should the customer receive on WhatsApp: acknowledgement, closure, others? And who will apply for the templates?

**Q18. Chatbot choices.** Confirm the business units (`WHATSAPP_SBUS`) and complaint categories (`WHATSAPP_CATEGORIES`) the chatbot offers, at most 10 each. Should the chatbot also offer languages other than English, such as Hindi?
*Placeholders:* AHP-Rumicare, AHP-Poultry, AHP-Aqua; Packaging, Product quality, Efficacy, Labelling, Other.

**Q15. File storage.** Which private storage should hold attachments (S3, Azure Blob, on-premise)? What file types and size limit are allowed, and how long are files retained?

**Q16. Data retention and privacy.** How long are complaints, audit logs and WhatsApp message logs kept? Are there data residency requirements for reporters outside India?

## Security policy

**Q17. Sign-in.** Should staff sign in with company single sign-on (Azure AD or Google Workspace) instead of passwords? The session layer is already separated, so adding single sign-on later would not change the rest of the system.
*Current settings:* passwords of at least 10 characters, a 15-minute lockout after 5 failures, and sessions of 10 hours.
