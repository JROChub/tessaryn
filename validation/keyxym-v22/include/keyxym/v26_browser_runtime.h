#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32) && defined(KEYXYM_V26_SHARED)
#  if defined(KEYXYM_V26_BUILD)
#    define KEYXYM_V26_API __declspec(dllexport)
#  else
#    define KEYXYM_V26_API __declspec(dllimport)
#  endif
#else
#  define KEYXYM_V26_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct keyxym_v26_session keyxym_v26_session;

enum {
    KEYXYM_V26_OK = 0,
    KEYXYM_V26_INVALID_ARGUMENT = 1,
    KEYXYM_V26_BUFFER_TOO_SMALL = 2,
    KEYXYM_V26_RUNTIME_ERROR = 3
};

enum {
    KEYXYM_V26_POSE_FLOATS = 27,
    KEYXYM_V26_QUALITY_FLOATS = 8,
    KEYXYM_V26_AUTHORITY_FLOATS = 8,
    KEYXYM_V26_PREVIEW_FLOATS = 10,
    KEYXYM_V26_GEOMETRY_FLOATS = 13,
    KEYXYM_V26_RECEIPT_BYTES = 96
};

KEYXYM_V26_API int keyxym_v26_session_create(
    const char* branch,
    float voxel_size_meters,
    size_t maximum_surfels,
    uint32_t maximum_analysis_width,
    uint32_t maximum_analysis_height,
    size_t maximum_tracks,
    size_t maximum_preview_samples,
    keyxym_v26_session** out_session);

KEYXYM_V26_API void keyxym_v26_session_destroy(keyxym_v26_session* session);

KEYXYM_V26_API int keyxym_v26_ingest_rgba_packed(
    keyxym_v26_session* session,
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

/* pose receipt, quality receipt, then authority-decision receipt */
KEYXYM_V26_API int keyxym_v26_copy_receipts(
    const keyxym_v26_session* session,
    uint8_t* output,
    size_t output_capacity,
    size_t* required_bytes);

KEYXYM_V26_API int keyxym_v26_copy_preview_packed(
    const keyxym_v26_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count);

KEYXYM_V26_API uint64_t keyxym_v26_geometry_revision(
    const keyxym_v26_session* session);

KEYXYM_V26_API int keyxym_v26_copy_geometry_snapshot_packed(
    const keyxym_v26_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count,
    uint64_t* revision);

KEYXYM_V26_API int keyxym_v26_quality_packed(
    const keyxym_v26_session* session,
    float* output,
    size_t output_float_count);

KEYXYM_V26_API int keyxym_v26_authority_packed(
    const keyxym_v26_session* session,
    float* output,
    size_t output_float_count);

KEYXYM_V26_API const char* keyxym_v26_status_message(int status);

#ifdef __cplusplus
}
#endif
