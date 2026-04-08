
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';

const predictiveMaintenancePath = path.join(__dirname, 'predictiveMaintenance.ts');
childProcess.execSync('bun run ' + predictiveMaintenancePath);
