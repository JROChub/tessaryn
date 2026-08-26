#include "keyxym/v26.hpp"
#include "keyxym/sha256.hpp"
#include "v26_internal.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <stdexcept>
#include <tuple>

namespace keyxym {
namespace {
struct Vec3 { float x{}; float y{}; float z{}; };
using Mat3 = std::array<float, 9>;
struct Pair { MetricFeatureObservation reference; MetricFeatureObservation current; Vec3 reference_bearing; Vec3 current_bearing; };
float clamp01(float value) { return std::max(0.0F, std::min(1.0F, value)); }
float dot(Vec3 a, Vec3 b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
Vec3 add(Vec3 a, Vec3 b) { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
Vec3 subtract(Vec3 a, Vec3 b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
Vec3 multiply(Vec3 value,float scalar) { return {value.x*scalar,value.y*scalar,value.z*scalar}; }
float length(Vec3 value) { return std::sqrt(std::max(0.0F,dot(value,value))); }
Vec3 normalize(Vec3 value) { const float magnitude=length(value); return magnitude>1.0e-8F&&std::isfinite(magnitude)?multiply(value,1.0F/magnitude):Vec3{}; }
bool finite(Vec3 value) { return std::isfinite(value.x)&&std::isfinite(value.y)&&std::isfinite(value.z); }
Vec3 transform(const Mat3& matrix,Vec3 value) { return {matrix[0]*value.x+matrix[1]*value.y+matrix[2]*value.z,matrix[3]*value.x+matrix[4]*value.y+matrix[5]*value.z,matrix[6]*value.x+matrix[7]*value.y+matrix[8]*value.z}; }
Mat3 rotation_of(const RigidPose& pose) { const auto& value=pose.world_from_camera; return {value[0],value[1],value[2],value[4],value[5],value[6],value[8],value[9],value[10]}; }
Vec3 translation_of(const RigidPose& pose) { const auto& value=pose.world_from_camera; return {value[3],value[7],value[11]}; }
Vec3 bearing(const MetricFrame& frame,const MetricFeatureObservation& feature) { const auto& camera=frame.camera.intrinsics; if(!(camera.fx>0.0F)||!(camera.fy>0.0F))return {}; return normalize({(feature.x-camera.cx)/camera.fx,(feature.y-camera.cy)/camera.fy,1.0F}); }
std::vector<Pair> pairs(const MetricFrame& reference,const MetricFrame& current) { std::map<std::uint32_t,MetricFeatureObservation> indexed; for(const auto& feature:reference.features)indexed.emplace(feature.id,feature); std::vector<Pair> output; output.reserve(std::min(reference.features.size(),current.features.size())); for(const auto& feature:current.features){const auto found=indexed.find(feature.id);if(found==indexed.end())continue;if(!std::isfinite(feature.x)||!std::isfinite(feature.y)||!std::isfinite(feature.match_error)||feature.match_error<0.0F||feature.match_error>4.0F)continue;const Vec3 left=bearing(reference,found->second);const Vec3 right=bearing(current,feature);if(!finite(left)||!finite(right)||length(left)<0.9F||length(right)<0.9F)continue;output.push_back({found->second,feature,left,right});}return output; }
bool closest_rays(Vec3 first_origin,Vec3 first_direction,Vec3 second_origin,Vec3 second_direction,float& first_depth,float& second_depth,Vec3& point){const Vec3 offset=subtract(first_origin,second_origin);const float a=dot(first_direction,first_direction),b=dot(first_direction,second_direction),c=dot(second_direction,second_direction),d=dot(first_direction,offset),e=dot(second_direction,offset),denominator=a*c-b*b;if(std::abs(denominator)<1.0e-7F)return false;first_depth=(b*e-c*d)/denominator;second_depth=(a*e-b*d)/denominator;point=multiply(add(add(first_origin,multiply(first_direction,first_depth)),add(second_origin,multiply(second_direction,second_depth))),0.5F);return finite(point);}
void append_u64(std::vector<Byte>& output,std::uint64_t value){for(int shift=56;shift>=0;shift-=8)output.push_back(Byte(value>>shift));}
void append_f32(std::vector<Byte>& output,float value){std::uint32_t bits{};std::memcpy(&bits,&value,sizeof(bits));for(int shift=24;shift>=0;shift-=8)output.push_back(Byte(bits>>shift));}
void append_text(std::vector<Byte>& output,const char* value){const std::size_t size=std::strlen(value);append_u64(output,size);output.insert(output.end(),value,value+size);}
Hash256 quality_receipt(const MetricReconstructionQuality& quality){std::vector<Byte> bytes;append_text(bytes,"keyxym/v26/reality-quality");append_f32(bytes,quality.tracking_confidence);append_f32(bytes,quality.parallax_degrees);append_f32(bytes,quality.reprojection_error_pixels);append_f32(bytes,quality.coverage);append_u64(bytes,quality.confirmed);append_u64(bytes,quality.uncertain);append_u64(bytes,quality.rejected);bytes.push_back(quality.metric_scale?Byte{1}:Byte{0});return sha256(bytes);}
MetricReconstructionQuality assess_quality_impl(const RealityPoseEstimate& pose,const std::vector<MetricSurfel>& surfels,std::uint64_t rejected,bool metric_scale){MetricReconstructionQuality quality;quality.tracking_confidence=pose.tracking_confidence;quality.parallax_degrees=pose.parallax_degrees;quality.reprojection_error_pixels=pose.reprojection_error_pixels;quality.rejected=rejected;quality.metric_scale=metric_scale;for(const auto& item:surfels){if(item.observations>=2U&&item.surfel.confidence>=0.55F&&item.uncertainty<=0.25F)++quality.confirmed;else ++quality.uncertain;}quality.coverage=float(quality.confirmed)/float(std::max<std::uint64_t>(1U,quality.confirmed+quality.uncertain));quality.receipt=quality_receipt(quality);return quality;}
void fuse_impl(std::vector<MetricSurfel>& accumulated,const std::vector<MetricSurfel>& incoming,float voxel_size,std::size_t maximum_surfels){std::map<std::tuple<long long,long long,long long>,MetricSurfel> voxels;auto add_item=[&](const MetricSurfel& item){const auto key=std::make_tuple(std::llround(item.surfel.x/voxel_size),std::llround(item.surfel.y/voxel_size),std::llround(item.surfel.z/voxel_size));const auto inserted=voxels.emplace(key,item);if(inserted.second)return;auto& prior=inserted.first->second;const float wa=prior.surfel.confidence/std::max(0.001F,prior.uncertainty),wb=item.surfel.confidence/std::max(0.001F,item.uncertainty),total=std::max(0.001F,wa+wb);auto weighted=[&](float a,float b){return(a*wa+b*wb)/total;};prior.surfel.x=weighted(prior.surfel.x,item.surfel.x);prior.surfel.y=weighted(prior.surfel.y,item.surfel.y);prior.surfel.z=weighted(prior.surfel.z,item.surfel.z);prior.surfel.nx=weighted(prior.surfel.nx,item.surfel.nx);prior.surfel.ny=weighted(prior.surfel.ny,item.surfel.ny);prior.surfel.nz=weighted(prior.surfel.nz,item.surfel.nz);const Vec3 normal=normalize({prior.surfel.nx,prior.surfel.ny,prior.surfel.nz});prior.surfel.nx=normal.x;prior.surfel.ny=normal.y;prior.surfel.nz=normal.z;prior.surfel.r=weighted(prior.surfel.r,item.surfel.r);prior.surfel.g=weighted(prior.surfel.g,item.surfel.g);prior.surfel.b=weighted(prior.surfel.b,item.surfel.b);prior.surfel.confidence=clamp01(prior.surfel.confidence+item.surfel.confidence*0.14F);prior.uncertainty=std::max(0.001F,std::min(prior.uncertainty,item.uncertainty)*0.90F);++prior.observations;prior.first_seen_ns=std::min(prior.first_seen_ns,item.first_seen_ns);prior.last_seen_ns=std::max(prior.last_seen_ns,item.last_seen_ns);};for(const auto& item:accumulated)add_item(item);for(const auto& item:incoming)add_item(item);if(voxels.size()>maximum_surfels)throw std::runtime_error("reality surfel limit exceeded");accumulated.clear();accumulated.reserve(voxels.size());for(const auto& entry:voxels)accumulated.push_back(entry.second);}
std::vector<MetricSurfel> confirmed_geometry_impl(const std::vector<MetricSurfel>& geometry){std::vector<MetricSurfel> output;for(const auto& item:geometry)if(item.observations>=2U&&item.surfel.confidence>=0.55F&&item.uncertainty<=0.25F)output.push_back(item);return output;}
} // namespace

namespace v26_detail {
MetricReconstructionQuality assess_quality(const RealityPoseEstimate& pose,const std::vector<MetricSurfel>& surfels,std::uint64_t rejected,bool metric_scale){return assess_quality_impl(pose,surfels,rejected,metric_scale);}
void fuse(std::vector<MetricSurfel>& accumulated,const std::vector<MetricSurfel>& incoming,float voxel_size,std::size_t maximum_surfels){fuse_impl(accumulated,incoming,voxel_size,maximum_surfels);}
std::vector<MetricSurfel> confirmed_geometry(const std::vector<MetricSurfel>& geometry){return confirmed_geometry_impl(geometry);}
} // namespace v26_detail

std::vector<MetricSurfel> triangulate_reality_surfels(
    const MetricFrame& reference,
    const RigidPose& world_from_reference,
    const MetricFrame& current,
    const RealityPoseEstimate& pose,
    std::uint32_t keyframe,
    std::uint64_t& rejected) {
    if (!pose.recovered) throw std::invalid_argument("reality pose not recovered");
    const auto correspondences = pairs(reference, current);
    const Vec3 first_origin = translation_of(world_from_reference);
    const Vec3 second_origin = translation_of(pose.pose);
    const Mat3 first_rotation = rotation_of(world_from_reference);
    const Mat3 second_rotation = rotation_of(pose.pose);
    const auto timestamp = std::uint64_t(current.timestamp.time_since_epoch().count());
    std::vector<MetricSurfel> output;
    output.reserve(correspondences.size());
    for (const auto& pair : correspondences) {
        if (pair.current.match_error > 2.5F) { ++rejected; continue; }
        const Vec3 first_direction = normalize(transform(first_rotation, pair.reference_bearing));
        const Vec3 second_direction = normalize(transform(second_rotation, pair.current_bearing));
        float first_depth = 0.0F;
        float second_depth = 0.0F;
        Vec3 point{};
        if (!closest_rays(first_origin, first_direction, second_origin, second_direction,
                          first_depth, second_depth, point) ||
            first_depth <= 0.02F || second_depth <= 0.02F ||
            first_depth > 100.0F || second_depth > 100.0F) {
            ++rejected;
            continue;
        }
        const Vec3 separation = subtract(add(first_origin, multiply(first_direction, first_depth)),
                                          add(second_origin, multiply(second_direction, second_depth)));
        const float ray_error = length(separation);
        if (!std::isfinite(ray_error) || ray_error > std::max(0.05F, first_depth * 0.03F)) {
            ++rejected;
            continue;
        }
        MetricSurfel item;
        item.surfel.x = point.x;
        item.surfel.y = point.y;
        item.surfel.z = point.z;
        const Vec3 normal = normalize(subtract(first_origin, point));
        item.surfel.nx = normal.x;
        item.surfel.ny = normal.y;
        item.surfel.nz = normal.z;
        std::array<float, 3> color{0.75F, 0.75F, 0.75F};
        if (!current.rgb.empty()) {
            const auto x = std::min<std::uint32_t>(current.camera.intrinsics.width - 1U,
                std::uint32_t(std::max(0.0F, pair.current.x)));
            const auto y = std::min<std::uint32_t>(current.camera.intrinsics.height - 1U,
                std::uint32_t(std::max(0.0F, pair.current.y)));
            const std::size_t pixel = std::size_t(y) * current.camera.intrinsics.width + x;
            if (pixel < current.rgb.size()) color = current.rgb[pixel];
        }
        item.surfel.r = color[0];
        item.surfel.g = color[1];
        item.surfel.b = color[2];
        const float geometric_support = 1.0F /
            (1.0F + ray_error * 20.0F + pair.current.match_error * 0.35F);
        item.surfel.confidence = clamp01(pose.tracking_confidence * geometric_support);
        item.surfel.timestamp_offset = timestamp;
        item.uncertainty = std::max(0.001F, std::min(1.0F,
            ray_error / std::max(0.05F, first_depth) +
            pose.reprojection_error_pixels / std::max(1.0F, pose.inliers * 0.25F)));
        item.first_seen_ns = timestamp;
        item.last_seen_ns = timestamp;
        item.source_keyframe = keyframe;
        output.push_back(item);
    }
    return output;
}

} // namespace keyxym
