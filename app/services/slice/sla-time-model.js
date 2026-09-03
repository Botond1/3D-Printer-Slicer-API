'use strict';

/**
 * Layer-count based SLA (MSLA) print-time model.
 *
 * The Saturn 4 Ultra uses a tilt-release mechanism, so per-layer motion time
 * is a printer constant rather than a lift-distance-dependent value: every
 * layer costs the same fixed motion time regardless of Z height. Total print
 * time is therefore purely a function of the parsed layer count, the exposure
 * time for the selected layer height, and the owner-tunable constants in the
 * SLA printer registry (`configs/sla/printers.json`). This is a model, not a
 * native slicer measurement; it is deterministic and reproducible so it can
 * be calibrated later against a real printer's or Chitubox's own estimate.
 */

const { getSlaTimeModel } = require('./sla-printer-registry');

const TIME_MODEL_SCHEMA = 'sla-layer-time-v1';

/**
 * Resolve the exposure time for an exact layer-height key.
 * @param {Readonly<Record<string, number>>} exposureSecondsByLayerHeight Registry exposure table.
 * @param {number|string} layerHeight Requested layer height.
 * @returns {number|null} Positive exposure seconds, or null when the layer height has no entry.
 */
function resolveExposureSeconds(exposureSecondsByLayerHeight, layerHeight) {
    const numericLayerHeight = Number.parseFloat(layerHeight);
    if (!Number.isFinite(numericLayerHeight)) return null;
    for (const [key, value] of Object.entries(exposureSecondsByLayerHeight)) {
        if (Math.abs(Number.parseFloat(key) - numericLayerHeight) < 1e-9) return value;
    }
    return null;
}

/**
 * Compute deterministic SLA print time in whole seconds from a parsed layer
 * count and the requested layer height.
 *
 * `layerCount` bottom layers get the bottom exposure plus bottom motion time,
 * the next `transitionLayers` get a linear fade between bottom and normal
 * exposure plus normal motion time, and every remaining layer gets the normal
 * exposure plus normal motion time. `bottomLayers`/`transitionLayers` are each
 * clipped to `layerCount` independently so a very short print never produces
 * a negative remaining-layer count.
 * @param {{layerCount: number, layerHeight: number|string, printerId?: string}} input Model input.
 * @returns {number} Deterministic total print time in whole seconds.
 */
function computeSlaPrintTime({ layerCount, layerHeight, printerId } = {}) {
    if (!Number.isInteger(layerCount) || layerCount < 1) {
        throw new Error('SLA print-time model requires a positive integer layer count.');
    }
    const timeModel = getSlaTimeModel(printerId);
    const exposureSeconds = resolveExposureSeconds(timeModel.exposureSecondsByLayerHeight, layerHeight);
    if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0) {
        throw new Error(`SLA print-time model has no exposure time for layer height ${layerHeight}.`);
    }

    const bottomLayers = Math.min(timeModel.bottomLayers, layerCount);
    const transitionLayers = Math.min(timeModel.transitionLayers, layerCount);
    const remainingLayers = Math.max(0, layerCount - bottomLayers - transitionLayers);

    const bottomSeconds = bottomLayers * (timeModel.bottomExposureSeconds + timeModel.motionSecondsPerBottomLayer);
    const transitionSeconds = transitionLayers * (
        ((timeModel.bottomExposureSeconds + exposureSeconds) / 2) + timeModel.motionSecondsPerLayer
    );
    const remainingSeconds = remainingLayers * (exposureSeconds + timeModel.motionSecondsPerLayer);

    return Math.round(bottomSeconds + transitionSeconds + remainingSeconds);
}

module.exports = {
    TIME_MODEL_SCHEMA,
    computeSlaPrintTime,
    resolveExposureSeconds
};
