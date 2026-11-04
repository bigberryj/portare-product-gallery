#!/usr/bin/env bash
# Action Scheduler runner for the Railway staging runtime.
#
# Why this exists: wp-config.php sets DISABLE_WP_CRON=true so that staging never
# runs WordPress's own scheduler. That isolation must stay, but it also means
# nothing drains Action Scheduler, so housekeeping actions pile up and WordPress
# admin shows "N past-due actions found; something may be wrong".
#
# This loop is the explicit runner. It executes ONLY local housekeeping hooks.
# Hooks that call third-party APIs (Google Listings & Ads, WooCommerce Payments,
# price-by-country sync) are deliberately excluded so the isolated staging
# runtime never performs outbound commerce or sync work.
#
# Runs alongside the container's OLS entrypoint; invoked in the background by
# railway-start.sh.
set -uo pipefail

DOCROOT=/var/www/html
# Action Scheduler's admin notice counts pending actions that are more than one
# minute past due, so the runner must tick faster than that or the notice can
# re-appear between cycles.
INTERVAL="${J5_ACTION_SCHEDULER_INTERVAL:-60}"
LOCK=/var/run/j5-action-scheduler.lock

SAFE_HOOKS="action_scheduler_run_actions_cleanup_hook,action_scheduler_run_recurring_actions_schedule_hook,action_scheduler/migration_hook,forminator_action_scheduler_cleanup,forminator_daily_cron,forminator_general_data_protection_cleanup,forminator_process_report,forminator_send_export,generate_category_lookup_table_wrapper,wc_admin_daily_wrapper,wc_deposits_job_scheduler,woocommerce_cancel_unpaid_orders,woocommerce_cleanup_draft_orders,woocommerce_cleanup_logs,woocommerce_cleanup_personal_data,woocommerce_cleanup_rate_limits_wrapper,woocommerce_cleanup_sessions,woocommerce_refresh_order_count_cache,woocommerce_refresh_product_count_cache,woocommerce_scheduled_sales,wc_price_based_country_scheduled_sales,wcpbc_schedule_recurring_action"

echo "[j5-action-scheduler] runner started (interval ${INTERVAL}s)"

while true; do
    sleep "$INTERVAL"

    if [[ ! -f "$DOCROOT/wp-load.php" ]]; then
        continue
    fi

    # Never let two runs overlap.
    if ! mkdir "$LOCK" 2>/dev/null; then
        continue
    fi

    output=$(timeout 300 php /usr/local/bin/wp \
        --path="$DOCROOT" --skip-themes --allow-root \
        action-scheduler run \
        --hooks="$SAFE_HOOKS" \
        --batch-size=25 --batches=4 2>&1)

    completed=$(printf '%s' "$output" | grep -c 'Completed processing action' || true)
    if [[ "${completed:-0}" -gt 0 ]]; then
        echo "[j5-action-scheduler] completed ${completed} action(s)"
    fi

    rmdir "$LOCK" 2>/dev/null || true
done
