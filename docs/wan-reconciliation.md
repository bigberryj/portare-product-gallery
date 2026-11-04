# Wan uncertain-job reconciliation runbook

**Before enabling paid generation:** ensure an administrator can inspect the configured Wan account's own task history. This release intentionally has no automatic abandon/reset control. A submission/status transport failure is not proof that no billable task exists.

1. Leave the job active and stop new submissions for that product. Record its job ID, product/user, requested frames/settings and approximate submission time. Never put credentials or signed result URLs in a support ticket.
2. In the actual Wan account, inspect task history for that time/input. Do not submit another clip merely to test whether the previous one exists.
3. If the recorded task is still active, restore access/status polling and resume that same task. An extended provider/read outage may require administrator assistance; restarting WordPress does not cancel the task.
4. If a task completed, retain/import that task's real result after the same byte validation. A pre-existing `_ppg_ai_job_id` attachment should be reused, not downloaded/imported again.
5. If no task ID was confirmed, an administrator must reconcile account history and credit events before authorizing a terminal bookkeeping change. Any manual job correction must be scoped to the exact job/product, backed up, and read back; retain a note of the reason and evidence. This is a separate operator-authorized action, not a blanket deletion of job/index/lock options.
6. Only after the old task is reconciled may the operator deliberately approve a new paid request. An expired timestamp, closed tab, failed HTTP response, `submitted`/`processing`/`unknown` state or restart is **not** authorization to retry.

Do not remove the active-job cap, expire uncertain rows automatically, or clear lock rows as an improvised workaround. If reconciliation cannot be established, keep generation blocked and report the unresolved state. The plugin can still use static setup pictures, the local still-sequence exporter and prepared videos independently.
