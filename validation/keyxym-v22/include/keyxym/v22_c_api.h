#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32) && defined(KEYXYM_V22_SHARED)
#  if defined(KEYXYM_V22_BUILD)
#    define KEYXYM_V22_API __declspec(dllexport)
#  else
#    define KEYXYM_V22_API __declspec(dllimport)
#  endif
#else
#  define KEYXYM_V22_API
#endif

#ifdef __cplusplus
#include <stdexcept>
extern "C" {
#endif

typedef struct keyxym_v22_session keyxym_v22_session;

typedef struct keyxym_v22_feature {
    uint32_t id;
    float x;
    float y;
    float score;
    float disparity;
    float match_error;
} keyxym_v22_feature;

typedef struct keyxym_v22_frame {
    int64_t timestamp_ns;
    uint32_t width;
    uint32_t height;
    float fx;
    float fy;
    float cx;
    float cy;
    float scale_meters_per_unit;
    uint8_t metric_scale;
    const float* rgb;
    size_t rgb_triplet_count;
    const keyxym_v22_feature* features;
    size_t feature_count;
    const uint8_t* source_commitment;
    size_t source_commitment_size;
} keyxym_v22_frame;

typedef struct keyxym_v22_pose {
    float world_from_camera[16];
    size_t matches;
    size_t inliers;
    float tracking_confidence;
    float parallax_degrees;
    float reprojection_error_pixels;
    uint8_t recovered;
    uint8_t receipt[32];
} keyxym_v22_pose;

typedef struct keyxym_v22_surfel {
    float x, y, z;
    float nx, ny, nz;
    float r, g, b;
    float confidence;
    float uncertainty;
    uint32_t observations;
    uint64_t first_seen_ns;
    uint64_t last_seen_ns;
    uint32_t source_keyframe;
} keyxym_v22_surfel;

typedef struct keyxym_v22_quality {
    float tracking_confidence;
    float parallax_degrees;
    float reprojection_error_pixels;
    float coverage;
    uint64_t confirmed;
    uint64_t uncertain;
    uint64_t rejected;
    uint8_t metric_scale;
    uint8_t receipt[32];
} keyxym_v22_quality;

enum {
    KEYXYM_V22_OK = 0,
    KEYXYM_V22_INVALID_ARGUMENT = 1,
    KEYXYM_V22_BUFFER_TOO_SMALL = 2,
    KEYXYM_V22_RUNTIME_ERROR = 3
};

enum {
    KEYXYM_V22_PACKED_FEATURE_FLOATS = 6,
    KEYXYM_V22_PACKED_POSE_FLOATS = 22,
    KEYXYM_V22_PACKED_SURFEL_FLOATS = 13,
    KEYXYM_V22_PACKED_QUALITY_FLOATS = 8
};

KEYXYM_V22_API int keyxym_v22_session_create(const char* branch,
                                               float voxel_size_meters,
                                               size_t maximum_surfels,
                                               keyxym_v22_session** out_session);
KEYXYM_V22_API void keyxym_v22_session_destroy(keyxym_v22_session* session);
KEYXYM_V22_API int keyxym_v22_session_ingest(keyxym_v22_session* session,
                                              const keyxym_v22_frame* frame,
                                              keyxym_v22_pose* out_pose);
KEYXYM_V22_API size_t keyxym_v22_session_geometry_count(const keyxym_v22_session* session);
KEYXYM_V22_API int keyxym_v22_session_copy_geometry(const keyxym_v22_session* session,
                                                     keyxym_v22_surfel* output,
                                                     size_t capacity,
                                                     size_t* required);
KEYXYM_V22_API int keyxym_v22_session_quality(const keyxym_v22_session* session,
                                               keyxym_v22_quality* output);

/* Browser-safe packed ABI. Feature records contain six floats:
 * id, x, y, score, disparity, match_error. Pose output contains the
 * 16-float matrix followed by matches, inliers, tracking, parallax,
 * reprojection error, and recovered. Geometry records contain thirteen
 * floats: position, normal, color, confidence, uncertainty, observations,
 * source keyframe. */
KEYXYM_V22_API int keyxym_v22_session_ingest_packed(
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
    const float* rgb,
    size_t rgb_triplet_count,
    const float* feature_records,
    size_t feature_count,
    const uint8_t* source_commitment,
    size_t source_commitment_size,
    float* pose_output,
    size_t pose_output_count);
KEYXYM_V22_API int keyxym_v22_session_copy_geometry_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count);
KEYXYM_V22_API int keyxym_v22_session_quality_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_count);

KEYXYM_V22_API const char* keyxym_v22_status_message(int status);

#ifdef __cplusplus
}
#endif
