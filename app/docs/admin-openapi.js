'use strict';

function adminKeyParameter() {
    return {
        name: 'x-api-key',
        in: 'header',
        required: true,
        schema: { type: 'string' }
    };
}

function createAdminPaths() {
    return {
        '/admin/output-files': {
            get: {
                tags: ['Admin'],
                summary: 'List generated files under output directory.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [adminKeyParameter()],
                security: [{ ArtifactApiKey: [] }],
                responses: {
                    200: {
                        description: 'Output files listed successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean', example: true },
                                        message: { type: 'string', example: 'Output directory is empty.' },
                                        total: { type: 'integer', example: 12 },
                                        files: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    fileName: {
                                                        type: 'string',
                                                        example: 'Cactus-output-1772126605107.gcode'
                                                    },
                                                    downloadUrl: {
                                                        type: 'string',
                                                        example: '/admin/download/Cactus-output-1772126605107.gcode'
                                                    },
                                                    sizeBytes: { type: 'integer', example: 409600 },
                                                    createdAt: { type: 'string', format: 'date-time' },
                                                    modifiedAt: { type: 'string', format: 'date-time' },
                                                    job_id: {
                                                        type: 'string',
                                                        pattern: '^job-[a-f0-9]{32}$'
                                                    },
                                                    artifact_id: {
                                                        type: 'string',
                                                        pattern: '^artifact-[a-f0-9]{32}$'
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    401: { description: 'Unauthorized' },
                    503: { description: 'Admin API key is not configured on server' },
                    500: { description: 'Failed to list output files' }
                }
            }
        },
        '/admin/download/{fileName}': {
            get: {
                tags: ['Admin'],
                summary: 'Download a generated output file from output directory.',
                description:
                    'Protected endpoint. Requires x-api-key header. Only managed .gcode, .sl1, and Bambu Studio .gcode.3mf files are allowed for direct file download. Use `ALL` as fileName to download every generated output file in a ZIP archive within MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.',
                parameters: [
                    {
                        name: 'fileName',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Output file name (for example `Camera-output-artifact-0123456789abcdef0123456789abcdef.gcode`) or the special token `ALL` for ZIP download.'
                    },
                    adminKeyParameter()
                ],
                security: [{ ArtifactApiKey: [] }],
                responses: {
                    200: {
                        description: 'Binary output stream (`application/octet-stream` for single file or `application/zip` for `ALL` token).',
                        content: {
                            'application/octet-stream': {
                                schema: { type: 'string', format: 'binary' }
                            },
                            'application/zip': {
                                schema: { type: 'string', format: 'binary' }
                            }
                        }
                    },
                    400: { description: 'Invalid file name/path' },
                    401: { description: 'Unauthorized' },
                    404: { description: 'Output file not found' },
                    413: {
                        description: 'Bulk ZIP download exceeds configured MAX_ZIP_ENTRIES or MAX_ZIP_UNCOMPRESSED_BYTES limits'
                    },
                    503: { description: 'Admin API key is not configured on server' },
                    500: { description: 'Failed to download output file' }
                }
            }
        }
    };
}

module.exports = { createAdminPaths };
