'use strict';

/** Startup import proof and fresh native identity checks for the automatic path. */
const fs = require('node:fs');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand, PYTHON_HELPER_TIMEOUT_MS } = require('./command');
const { assertBambuBuildCurrent } = require('./bambu-generation');

function createBambuReadiness(options = {}) {
    const runner = options.runner || runCommand;
    const assertBuild = options.assertBuild || assertBambuBuildCurrent;
    let versions = {};
    let dependencies = [];
    let imported = false;

    async function initialize(engineVersions) {
        const result = await runner(PYTHON_EXECUTABLE, ['-c',
            'import json,sys,numpy,trimesh,scipy,gmsh,lxml,networkx,PIL; print(json.dumps([sys.executable]+[m.__file__ for m in (numpy,trimesh,scipy,gmsh,lxml,networkx,PIL)]))'],
        { timeoutMs: PYTHON_HELPER_TIMEOUT_MS });
        dependencies = JSON.parse(result.stdout);
        if (!Array.isArray(dependencies) || dependencies.length !== 8
            || dependencies.some((value) => typeof value !== 'string' || !value)) {
            throw new Error('Common Python dependencies were not verified.');
        }
        versions = { ...engineVersions };
        imported = true;
    }

    function getStatus() {
        let bambuReady = false;
        try { assertBuild(); bambuReady = Boolean(versions.bambu); } catch { /* bounded unavailable state */ }
        const commonDependenciesReady = imported && dependencies.every((file) => {
            try { return fs.statSync(file).isFile(); } catch { return false; }
        });
        const engines = Object.fromEntries(['bambu', 'prusa', 'orca'].map((engine) => [engine, {
            available: engine === 'bambu' ? bambuReady : Boolean(versions[engine]),
            version: versions[engine] || null,
            required_for_bambu: engine === 'bambu'
        }]));
        return { bambuReady, commonDependenciesReady, engines,
            dependencyEvidence: 'startup_import_and_fresh_file_presence' };
    }

    function isEngineAvailable(engine) {
        if (engine === 'bambu') {
            const status = getStatus();
            return status.bambuReady && status.commonDependenciesReady;
        }
        // Other engines retain their routes; absence never selects a substitute.
        return Boolean(versions[engine]);
    }
    return { initialize, getStatus, isEngineAvailable };
}

module.exports = { createBambuReadiness };
