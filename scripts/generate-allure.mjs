#!/usr/bin/env node
import {projectArgument} from './lib/consumer-paths.mjs';
import {generateAllure} from './lib/reporting/allure.mjs';
try {
  const {roots, args} = projectArgument();
  if (args.length !== 2 || args[0] !== '--input') throw new Error('Use --input with a relative captured report directory.');
  const result = await generateAllure(roots, args[1]); console.log(JSON.stringify(result)); if (result.status !== 'GENERATED') process.exitCode = 1;
} catch {console.error(JSON.stringify({status: 'FAILED', reason: 'Invalid consumer reporting arguments.'})); process.exitCode = 2;}
