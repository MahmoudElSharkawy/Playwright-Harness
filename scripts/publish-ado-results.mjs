#!/usr/bin/env node
// Compatibility entrypoint; see docs/M12-ADO.md for configuration and explicit write flags.
import {compatibilityMain} from './lib/integrations/compatibility.mjs';
compatibilityMain('publish-ado-results');
