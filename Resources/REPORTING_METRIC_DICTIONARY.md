# Nexora reporting metric dictionary

## Snapshot metrics

- **Current projects:** project records in the authorized dashboard snapshot at cutoff.
- **Current tasks:** all visible tasks at cutoff, across every workflow stage.
- **Current closed-task rate:** currently Closed tasks divided by all current tasks.
- **Current overdue non-closed rate:** overdue non-closed tasks divided by all current non-closed tasks.
- **Task assignment coverage:** current tasks with a named assignee divided by current tasks.
- **Project stakeholder coverage:** current projects with a named stakeholder divided by current projects. This is not accountable-owner coverage.

## Reporting-period movement

- **Closure events in period:** `TASK_CLOSED` access-log records within the reporting window.
- **Unique tasks with closure events:** distinct current task IDs represented by those closure events.
- **Recorded workflow events:** access-log records within the reporting window. Event volume is a traceability signal, not value or productivity.
- **Active contributors:** distinct verified human actors in period events or work logs. Known shared/system labels are excluded.
- **Self-reported work-log hours:** hours entered in work logs dated within the reporting window. These are not an individual productivity measure.

## Recommended configurable RAG starting points

- Overdue rate: Green <=10%, Amber >10% to 20%, Red >20%.
- Assignment coverage: Green >=98%, Amber 95% to 97.9%, Red <95%.
- Stakeholder/accountable-owner coverage: Green 100%, Amber 95% to 99.9%, Red <95%.

These are recommended defaults, not established Nexora targets.
