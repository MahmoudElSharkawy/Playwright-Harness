#!/usr/bin/env node
import {compatibilityMain} from './lib/integrations/compatibility.mjs';
const [command, ...args] = process.argv.slice(2);
compatibilityMain(command, args);
