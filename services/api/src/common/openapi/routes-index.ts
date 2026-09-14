/**
 * Side-effect imports that register every route's documentation.
 *
 * Route metadata is declared next to the handler with `documentRoute`. Importing
 * the controllers here guarantees the published contract is complete even when a
 * module is lazily resolved, and makes an unregistered endpoint visible as a
 * missing import rather than as a quietly absent path.
 */
import '../../access/access.controller';
import '../../analytics/analytics.controller';
import '../../assets/assets.controller';
import '../../audit/audit.controller';
import '../../cases/cases.controller';
import '../../emergency/emergency.controller';
import '../../health/health.controller';
import '../../iam/admin.controller';
import '../../integration/integration.controller';
import '../../iam/auth.controller';
import '../../identity/citizen-portal.controller';
import '../../identity/citizens.controller';
import '../../missing-persons/missing-persons.controller';
import '../../oversight/oversight.controller';
