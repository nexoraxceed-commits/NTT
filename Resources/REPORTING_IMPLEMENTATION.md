# Nexora reporting implementation

## Outputs

- Board report: `GET /reports/board.pdf?days=30&exclude_test_projects=false`
- Team operating report: `GET /reports/team.pdf?days=30`
- Full-period evidence export: `GET /reports/evidence.csv?days=30`

All three endpoints require an authenticated administrator. They use the same dashboard extraction and metric model, so definitions remain consistent across outputs.

## Regeneration

1. Run `Resources/20260808_REPORTING_UPGRADE.sql` in the Supabase SQL editor.
2. Deploy the backend.
3. Sign in as an administrator.
4. Call the desired endpoint with the normal bearer access token.
5. Set `days` from 7 to 366. Set `exclude_test_projects=true` on the board endpoint when the approved reporting scope excludes flagged test records.

The files named `preview-*` are deterministic acceptance previews based on the supplied 24-project, 44-task reporting fixture. Production endpoints regenerate reports from the current authorized dataset at request time.

## Fields and calculations still unavailable

- Financial value, customer impact and realized organizational outcomes.
- Approved strategic objectives, project categories and priority tiers until populated.
- Accountable owner and executive sponsor coverage until populated.
- Reliable on-time completion without immutable original due dates for historical records.
- Cycle time, lead time and age in status without complete lifecycle timestamps.
- Commitment reliability until weekly commitments and acceptance are explicitly recorded.
- Removed or archived task reconciliation for historical closure events outside the current snapshot.
- Previous-period comparisons unless an equivalent historical snapshot is retained.

These values appear as `Not yet captured` or `Not available`; the reports do not substitute zero or invent estimates.

## Records requiring management validation

The validation layer flags, without modifying data:

- normalized duplicate project-name candidates;
- possible test projects;
- active projects with zero tasks;
- projects missing a stakeholder or accountable owner;
- repeated creation or closure events;
- ambiguous shared/system accounts in contributor evidence;
- incomplete task ownership and reporting fields.

The report's Data Quality appendix lists the actual records detected for the selected report scope.

## Migration notes

The migration is additive and rerunnable. New reporting fields are nullable so historical records remain truthful. A trigger maintains normalized project names for future duplicate detection. Access-log indexes are created only when the lifecycle table exists.
