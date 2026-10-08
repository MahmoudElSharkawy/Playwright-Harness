#!/usr/bin/env node
// Read-only story retrieval entrypoint; see docs/azure-devops.md for configuration and link selection.
import {compatibilityMain} from './lib/integrations/compatibility.mjs';
compatibilityMain('fetch-ado-story');
