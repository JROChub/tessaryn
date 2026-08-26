#pragma once

#include "v22_c_api.h"

#ifdef __cplusplus
extern "C" {
#endif

enum {
    KEYXYM_V22_BROWSER_PREVIEW_FLOATS = 10,
    KEYXYM_V22_BROWSER_GEOMETRY_FLOATS = KEYXYM_V22_PACKED_SURFEL_FLOATS,
    KEYXYM_V22_BROWSER_RECEIPT_BYTES = 64
};

typedef struct keyxym_v22_browser_frame {
    int64_t timestamp_ns;
    uint32_t width;
    uint32_t height;
    float fx;
    float fy;
    float cx;
    float cy;
    float scale_meters_per_unit;
    uint8_t metric_scale;
    const uint8_t* rgba;
    size_t rgba_size;
    const uint8_t* source_commitment;
    size_t source_commitment_size;
} keyxym_v22_browser_frame;

KEYXYM_V22_API int keyxym_v22_browser_session_create(
    const char* branch,
    float voxel_size_meters,
    size_t maximum_surfels,
    uint32_t maximum_analysis_width,
    uint32_t maximum_analysis_height,
    size_t maximum_tracks,
    size_t maximum_preview_samples,
    keyxym_v22_session** out_session);

KEYXYM_V22_API void keyxym_v22_browser_session_destroy(keyxym_v22_session* session);

KEYXYM_V22_API int keyxym_v22_browser_ingest_rgba(
    keyxym_v22_session* session,
    const keyxym_v22_browser_frame* frame,
    float* pose_output,
    size_t pose_output_count);

/* Browser-safe flattened ingest ABI. This avoids JavaScript dependence on the
 * native frame struct's compiler-specific padding and pointer alignment. */
KEYXYM_V22_API int keyxym_v22_browser_ingest_rgba_packed(
    keyxym_v22_session* session,
    int64_t timestamp_ns,
    uint32_t width,
    uint32_t height,
    float fx,
    float fy,
    float cx,
    float cy,
    float scale_meters_per_unit,
    uint8_t metric_scale,
    const uint8_t* rgba,
    size_t rgba_size,
    const uint8_t* source_commitment,
    size_t source_commitment_size,
    float* pose_output,
    size_t pose_output_count);

/* The first 32 bytes are the latest pose receipt and the second 32 bytes are
 * the latest reconstruction-quality receipt. */
KEYXYM_V22_API int keyxym_v22_browser_copy_receipts(
    const keyxym_v22_session* session,
    uint8_t* output,
    size_t output_capacity,
    size_t* required_bytes);

/* Screen-space forming-field samples. Records contain normalized position,
 * normalized flow, RGB, salience, track support, and track age. They are
 * immediate visual observations and are never authoritative geometry. */
KEYXYM_V22_API int keyxym_v22_browser_copy_preview_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count);

/* Fused geometry is mutable, so the browser ABI exposes complete revisioned
 * snapshots rather than an incorrect append-only delta. */
KEYXYM_V22_API uint64_t keyxym_v22_browser_geometry_revision(
    const keyxym_v22_session* session);
KEYXYM_V22_API int keyxym_v22_browser_copy_geometry_snapshot_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count,
    uint64_t* revision);

#ifdef __cplusplus
}
#endif
