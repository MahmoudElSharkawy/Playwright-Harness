#!/usr/bin/env node
// Read-only story retrieval entrypoint; see docs/M12-ADO.md for configuration and link selection.
import {compatibilityMain} from './lib/integrations/compatibility.mjs';
compatibilityMain('fetch-ado-story');
