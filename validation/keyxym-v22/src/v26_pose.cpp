#include "keyxym/v26.hpp"
#include "keyxym/sha256.hpp"
#include "v26_internal.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <stdexcept>
#include <tuple>
#include <utility>

namespace keyxym {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr float kRadToDeg = 180.0F / kPi;
struct Vec3 { float x{}; float y{}; float z{}; };
using Mat3 = std::array<float, 9>;
struct Pair { MetricFeatureObservation reference; MetricFeatureObservation current; Vec3 reference_bearing; Vec3 current_bearing; };
struct Eigen3 { std::array<float, 3> values{}; Mat3 vectors{1,0,0,0,1,0,0,0,1}; };
float clamp01(float value) { return std::max(0.0F, std::min(1.0F, value)); }
float dot(Vec3 a, Vec3 b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
Vec3 cross(Vec3 a, Vec3 b) { return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x}; }
Vec3 add(Vec3 a, Vec3 b) { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
Vec3 subtract(Vec3 a,Vec3 b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
Vec3 multiply(Vec3 value,float scalar) { return {value.x*scalar,value.y*scalar,value.z*scalar}; }
float length(Vec3 value) { return std::sqrt(std::max(0.0F,dot(value,value))); }
Vec3 normalize(Vec3 value) { const float magnitude=length(value); return magnitude>1.0e-8F&&std::isfinite(magnitude)?multiply(value,1.0F/magnitude):Vec3{}; }
bool finite(Vec3 value) { return std::isfinite(value.x)&&std::isfinite(value.y)&&std::isfinite(value.z); }
Mat3 identity3() { return {1,0,0,0,1,0,0,0,1}; }
Mat3 transpose(const Mat3& matrix) { return {matrix[0],matrix[3],matrix[6],matrix[1],matrix[4],matrix[7],matrix[2],matrix[5],matrix[8]}; }
Vec3 transform(const Mat3& matrix,Vec3 value) { return {matrix[0]*value.x+matrix[1]*value.y+matrix[2]*value.z,matrix[3]*value.x+matrix[4]*value.y+matrix[5]*value.z,matrix[6]*value.x+matrix[7]*value.y+matrix[8]*value.z}; }
Mat3 multiply(const Mat3& left,const Mat3& right){Mat3 output{};for(int row=0;row<3;++row)for(int column=0;column<3;++column){float value=0.0F;for(int inner=0;inner<3;++inner)value+=left[std::size_t(row*3+inner)]*right[std::size_t(inner*3+column)];output[std::size_t(row*3+column)]=value;}return output;}
Mat3 rotation_of(const RigidPose& pose){const auto& value=pose.world_from_camera;return {value[0],value[1],value[2],value[4],value[5],value[6],value[8],value[9],value[10]};}
Vec3 translation_of(const RigidPose& pose){const auto& value=pose.world_from_camera;return {value[3],value[7],value[11]};}
RigidPose make_pose(const Mat3& rotation,Vec3 translation){RigidPose pose;pose.world_from_camera={rotation[0],rotation[1],rotation[2],translation.x,rotation[3],rotation[4],rotation[5],translation.y,rotation[6],rotation[7],rotation[8],translation.z,0,0,0,1};return pose;}
void append_u64(std::vector<Byte>& output,std::uint64_t value){for(int shift=56;shift>=0;shift-=8)output.push_back(Byte(value>>shift));}
void append_f32(std::vector<Byte>& output,float value){std::uint32_t bits{};std::memcpy(&bits,&value,sizeof(bits));for(int shift=24;shift>=0;shift-=8)output.push_back(Byte(bits>>shift));}
void append_text(std::vector<Byte>& output,const char* value){const std::size_t size=std::strlen(value);append_u64(output,size);output.insert(output.end(),value,value+size);}
void append_hash(std::vector<Byte>& output,const Hash256& value){output.insert(output.end(),value.begin(),value.end());}
float median(std::vector<float> values){if(values.empty())return 0.0F;const auto middle=values.begin()+static_cast<std::ptrdiff_t>(values.size()/2U);std::nth_element(values.begin(),middle,values.end());return *middle;}
Vec3 bearing(const MetricFrame& frame,const MetricFeatureObservation& feature){const auto& camera=frame.camera.intrinsics;if(!(camera.fx>0.0F)||!(camera.fy>0.0F))return {};return normalize({(feature.x-camera.cx)/camera.fx,(feature.y-camera.cy)/camera.fy,1.0F});}
std::vector<Pair> pairs(const MetricFrame& reference,const MetricFrame& current){std::map<std::uint32_t,MetricFeatureObservation> indexed;for(const auto& feature:reference.features)indexed.emplace(feature.id,feature);std::vector<Pair> output;output.reserve(std::min(reference.features.size(),current.features.size()));for(const auto& feature:current.features){const auto found=indexed.find(feature.id);if(found==indexed.end())continue;if(!std::isfinite(feature.x)||!std::isfinite(feature.y)||!std::isfinite(feature.match_error)||feature.match_error<0.0F||feature.match_error>4.0F)continue;const Vec3 left=bearing(reference,found->second);const Vec3 right=bearing(current,feature);if(!finite(left)||!finite(right)||length(left)<0.9F||length(right)<0.9F)continue;output.push_back({found->second,feature,left,right});}return output;}
Mat3 quaternion_rotation(const std::array<float,4>& q){const float w=q[0],x=q[1],y=q[2],z=q[3];return {1.0F-2.0F*(y*y+z*z),2.0F*(x*y-z*w),2.0F*(x*z+y*w),2.0F*(x*y+z*w),1.0F-2.0F*(x*x+z*z),2.0F*(y*z-x*w),2.0F*(x*z-y*w),2.0F*(y*z+x*w),1.0F-2.0F*(x*x+y*y)};}
Mat3 estimate_rotation(const std::vector<Pair>& correspondences,const std::vector<float>& weights){Mat3 covariance{};for(std::size_t index=0;index<correspondences.size();++index){const float weight=weights[index];const Vec3 current=correspondences[index].current_bearing;const Vec3 reference=correspondences[index].reference_bearing;const float cv[3]={current.x,current.y,current.z};const float rv[3]={reference.x,reference.y,reference.z};for(int row=0;row<3;++row)for(int column=0;column<3;++column)covariance[std::size_t(row*3+column)]+=weight*cv[row]*rv[column];}const float sxx=covariance[0],sxy=covariance[1],sxz=covariance[2],syx=covariance[3],syy=covariance[4],syz=covariance[5],szx=covariance[6],szy=covariance[7],szz=covariance[8],trace=sxx+syy+szz;const std::array<float,16> davenport={trace,syz-szy,szx-sxz,sxy-syx,syz-szy,sxx-syy-szz,sxy+syx,szx-sxz,sxy+syx,-sxx+syy-szz,syz+szy,sxy-syx,szx+sxz,syz+szy,-sxx-syy+szz};std::array<float,4> q{1,0,0,0};for(int iteration=0;iteration<48;++iteration){std::array<float,4> next{};for(int row=0;row<4;++row)for(int column=0;column<4;++column)next[std::size_t(row)]+=davenport[std::size_t(row*4+column)]*q[std::size_t(column)];const float magnitude=std::sqrt(std::max(1.0e-20F,next[0]*next[0]+next[1]*next[1]+next[2]*next[2]+next[3]*next[3]));for(std::size_t component=0;component<q.size();++component)q[component]=next[component]/magnitude;}return quaternion_rotation(q);}
Eigen3 jacobi_eigen(Mat3 matrix){Eigen3 output;for(int iteration=0;iteration<24;++iteration){int p=0,q=1;float largest=std::abs(matrix[1]);const struct Candidate{int p;int q;std::size_t index;} candidates[]={{0,2,2},{1,2,5}};for(const auto& candidate:candidates){const float value=std::abs(matrix[candidate.index]);if(value>largest){largest=value;p=candidate.p;q=candidate.q;}}if(largest<1.0e-10F)break;const float app=matrix[std::size_t(p*3+p)],aqq=matrix[std::size_t(q*3+q)],apq=matrix[std::size_t(p*3+q)],angle=0.5F*std::atan2(2.0F*apq,aqq-app),cosine=std::cos(angle),sine=std::sin(angle);for(int k=0;k<3;++k){const float mkp=matrix[std::size_t(k*3+p)],mkq=matrix[std::size_t(k*3+q)];matrix[std::size_t(k*3+p)]=cosine*mkp-sine*mkq;matrix[std::size_t(k*3+q)]=sine*mkp+cosine*mkq;}for(int k=0;k<3;++k){const float mpk=matrix[std::size_t(p*3+k)],mqk=matrix[std::size_t(q*3+k)];matrix[std::size_t(p*3+k)]=cosine*mpk-sine*mqk;matrix[std::size_t(q*3+k)]=sine*mpk+cosine*mqk;}for(int k=0;k<3;++k){const float vkp=output.vectors[std::size_t(k*3+p)],vkq=output.vectors[std::size_t(k*3+q)];output.vectors[std::size_t(k*3+p)]=cosine*vkp-sine*vkq;output.vectors[std::size_t(k*3+q)]=sine*vkp+cosine*vkq;}}output.values={matrix[0],matrix[4],matrix[8]};return output;}
struct TranslationEstimate{Vec3 direction{};float observability{};};
TranslationEstimate estimate_translation(const std::vector<Pair>& correspondences,const std::vector<float>& weights,const Mat3& rotation){Mat3 normal{};for(std::size_t index=0;index<correspondences.size();++index){const Vec3 rotated=transform(rotation,correspondences[index].reference_bearing);const Vec3 constraint=cross(correspondences[index].current_bearing,rotated);const float values[3]={constraint.x,constraint.y,constraint.z};for(int row=0;row<3;++row)for(int column=0;column<3;++column)normal[std::size_t(row*3+column)]+=weights[index]*values[row]*values[column];}const Eigen3 eigen=jacobi_eigen(normal);std::array<int,3> order{0,1,2};std::sort(order.begin(),order.end(),[&](int left,int right){return eigen.values[std::size_t(left)]<eigen.values[std::size_t(right)];});const int minimum=order[0];Vec3 direction=normalize({eigen.vectors[std::size_t(minimum)],eigen.vectors[std::size_t(3+minimum)],eigen.vectors[std::size_t(6+minimum)]});const float smallest=std::max(0.0F,eigen.values[std::size_t(order[0])]);const float middle=std::max(smallest,eigen.values[std::size_t(order[1])]);const float largest=std::max(middle,eigen.values[std::size_t(order[2])]);return {direction,clamp01((middle-smallest)/std::max(1.0e-8F,largest))};}
float epipolar_residual(const Pair& pair,const Mat3& rotation,Vec3 translation){const Vec3 constraint=cross(pair.current_bearing,transform(rotation,pair.reference_bearing));return std::abs(dot(translation,constraint))/std::max(1.0e-8F,length(constraint));}
float rotation_angle_degrees(const Mat3& rotation){const float cosine=std::max(-1.0F,std::min(1.0F,(rotation[0]+rotation[4]+rotation[8]-1.0F)*0.5F));return std::acos(cosine)*kRadToDeg;}
float epipolar_model_score(const std::vector<Pair>& correspondences,const Mat3& rotation){const float angle=rotation_angle_degrees(rotation);if(angle>8.0F)return std::numeric_limits<float>::infinity();std::vector<float> weights(correspondences.size(),1.0F);const auto translation=estimate_translation(correspondences,weights,rotation);if(!finite(translation.direction)||length(translation.direction)<0.9F)return std::numeric_limits<float>::infinity();std::vector<float> residuals;residuals.reserve(correspondences.size());for(const auto& pair:correspondences){if(pair.current.match_error>2.5F)continue;residuals.push_back(epipolar_residual(pair,rotation,translation.direction));}if(residuals.size()<10U)return std::numeric_limits<float>::infinity();const float center=median(residuals);std::sort(residuals.begin(),residuals.end());const float upper=residuals[(residuals.size()*3U)/4U];return center+0.35F*upper+angle*1.5e-4F;}
bool closest_rays(Vec3 first_origin,Vec3 first_direction,Vec3 second_origin,Vec3 second_direction,float& first_depth,float& second_depth,Vec3& point){const Vec3 offset=subtract(first_origin,second_origin);const float a=dot(first_direction,first_direction),b=dot(first_direction,second_direction),c=dot(second_direction,second_direction),d=dot(first_direction,offset),e=dot(second_direction,offset),denominator=a*c-b*b;if(std::abs(denominator)<1.0e-7F)return false;first_depth=(b*e-c*d)/denominator;second_depth=(a*e-b*d)/denominator;point=multiply(add(add(first_origin,multiply(first_direction,first_depth)),add(second_origin,multiply(second_direction,second_depth))),0.5F);return finite(point);}
int positive_depth_count(const std::vector<Pair>& correspondences,const Mat3& rotation,Vec3 translation){const Mat3 current_to_reference=transpose(rotation);const Vec3 current_origin=multiply(transform(current_to_reference,translation),-1.0F);int positive=0;for(const auto& pair:correspondences){float first_depth=0.0F,second_depth=0.0F;Vec3 point{};if(closest_rays({},pair.reference_bearing,current_origin,transform(current_to_reference,pair.current_bearing),first_depth,second_depth,point)&&first_depth>0.0F&&second_depth>0.0F)++positive;}return positive;}
struct MotionHypothesis{Mat3 rotation{identity3()};TranslationEstimate translation{};std::size_t inliers{};int positive_depth{};float median_residual{std::numeric_limits<float>::infinity()};float model_score{std::numeric_limits<float>::infinity()};float rotation_degrees{};};
MotionHypothesis fit_hypothesis(const std::vector<Pair>& correspondences,const Mat3& initial_rotation,bool refine_rotation,float focal){MotionHypothesis hypothesis;hypothesis.rotation=initial_rotation;std::vector<float> weights(correspondences.size(),1.0F);std::vector<float> residuals(correspondences.size(),1.0F);for(int iteration=0;iteration<5;++iteration){if(refine_rotation)hypothesis.rotation=estimate_rotation(correspondences,weights);hypothesis.translation=estimate_translation(correspondences,weights,hypothesis.rotation);for(std::size_t index=0;index<correspondences.size();++index)residuals[index]=epipolar_residual(correspondences[index],hypothesis.rotation,hypothesis.translation.direction);const float scale=std::max(0.0015F,median(residuals)*2.5F);for(std::size_t index=0;index<weights.size();++index){const float normalized=residuals[index]/scale;const float robust=normalized<=1.0F?1.0F:1.0F/normalized;const float feature=1.0F/(1.0F+std::max(0.0F,correspondences[index].current.match_error));weights[index]=robust*feature;}}hypothesis.model_score=epipolar_model_score(correspondences,hypothesis.rotation);if(!finite(hypothesis.translation.direction)||length(hypothesis.translation.direction)<0.9F)return hypothesis;const int positive=positive_depth_count(correspondences,hypothesis.rotation,hypothesis.translation.direction);const int negative=positive_depth_count(correspondences,hypothesis.rotation,multiply(hypothesis.translation.direction,-1.0F));if(negative>positive)hypothesis.translation.direction=multiply(hypothesis.translation.direction,-1.0F);hypothesis.positive_depth=std::max(positive,negative);const float threshold=std::max(0.006F,6.0F/focal);std::vector<float> accepted;for(const auto& pair:correspondences){const float residual=epipolar_residual(pair,hypothesis.rotation,hypothesis.translation.direction);if(residual>threshold||pair.current.match_error>2.5F)continue;++hypothesis.inliers;accepted.push_back(residual);}hypothesis.median_residual=median(std::move(accepted));hypothesis.rotation_degrees=rotation_angle_degrees(hypothesis.rotation);return hypothesis;}
bool stronger_hypothesis(const MotionHypothesis& candidate,const MotionHypothesis& incumbent,std::size_t matches){const bool physical_mixed=candidate.rotation_degrees>=2.0F&&candidate.rotation_degrees<=8.0F&&candidate.inliers*10U>=incumbent.inliers*7U;if(physical_mixed)return true;if(std::isfinite(candidate.model_score)&&std::isfinite(incumbent.model_score)){if(candidate.model_score+1.0e-7F<incumbent.model_score*0.995F)return true;if(incumbent.model_score+1.0e-7F<candidate.model_score*0.995F)return false;}if(std::isfinite(candidate.median_residual)&&std::isfinite(incumbent.median_residual)){if(candidate.median_residual<incumbent.median_residual*0.8F)return true;if(incumbent.median_residual<candidate.median_residual*0.8F)return false;}const std::size_t material=std::max<std::size_t>(3U,matches/20U);if(candidate.inliers>=incumbent.inliers+material)return true;if(incumbent.inliers>=candidate.inliers+material)return false;if(candidate.positive_depth!=incumbent.positive_depth)return candidate.positive_depth>incumbent.positive_depth;if(candidate.translation.observability>incumbent.translation.observability+0.01F)return true;if(incumbent.translation.observability>candidate.translation.observability+0.01F)return false;const float candidate_cost=candidate.median_residual+candidate.rotation_degrees*2.0e-5F;const float incumbent_cost=incumbent.median_residual+incumbent.rotation_degrees*2.0e-5F;return candidate_cost<incumbent_cost;}
RigidPose compose_pose(const RigidPose& world_from_reference,const Mat3& reference_to_current,Vec3 translation_current){const Mat3 world_rotation=rotation_of(world_from_reference);const Mat3 current_to_reference=transpose(reference_to_current);const Mat3 world_from_current_rotation=multiply(world_rotation,current_to_reference);const Vec3 current_center_reference=multiply(transform(current_to_reference,translation_current),-1.0F);return make_pose(world_from_current_rotation,add(translation_of(world_from_reference),transform(world_rotation,current_center_reference)));}
Hash256 pose_receipt_impl(const RealityPoseEstimate& pose,const MetricFrame& reference,const MetricFrame& current){std::vector<Byte> bytes;append_text(bytes,"keyxym/v26/reality-pose");for(float value:pose.pose.world_from_camera)append_f32(bytes,value);append_u64(bytes,pose.matches);append_u64(bytes,pose.inliers);append_f32(bytes,pose.tracking_confidence);append_f32(bytes,pose.parallax_degrees);append_f32(bytes,pose.reprojection_error_pixels);append_f32(bytes,pose.rotation_degrees);append_f32(bytes,pose.translation_observability);bytes.push_back(pose.recovered?Byte{1}:Byte{0});bytes.push_back(pose.degenerate?Byte{1}:Byte{0});bytes.push_back(pose.relocalized?Byte{1}:Byte{0});append_hash(bytes,reference.source_commitment);append_hash(bytes,current.source_commitment);return sha256(bytes);}
} // namespace

namespace v26_detail {
Hash256 pose_receipt(const RealityPoseEstimate& pose,const MetricFrame& reference,const MetricFrame& current){return pose_receipt_impl(pose,reference,current);}
} // namespace v26_detail

RealityPoseEstimate recover_reality_pose(const MetricFrame& reference,
                                         const MetricFrame& current,
                                         const RigidPose& world_from_reference) {
    RealityPoseEstimate result;
    result.pose = world_from_reference;
    const auto correspondences = pairs(reference, current);
    result.matches = correspondences.size();
    if (correspondences.size() < 12U) return result;
    const float focal = std::max(1.0F, 0.5F * (current.camera.intrinsics.fx + current.camera.intrinsics.fy));
    const MotionHypothesis translation_only = fit_hypothesis(correspondences, identity3(), false, focal);
    const MotionHypothesis rotation_and_translation = fit_hypothesis(correspondences, identity3(), true, focal);
    const MotionHypothesis& selected = stronger_hypothesis(rotation_and_translation, translation_only,
                                                            correspondences.size())
        ? rotation_and_translation : translation_only;
    if (!finite(selected.translation.direction) || length(selected.translation.direction) < 0.9F) return result;
    result.inliers = selected.inliers;
    if (result.inliers < 10U) return result;
    float error_sum = 0.0F;
    std::vector<float> parallax;
    std::vector<float> normalized_motion;
    const float inlier_threshold = std::max(0.006F, 6.0F / focal);
    for (const auto& pair : correspondences) {
        const float residual = epipolar_residual(pair, selected.rotation, selected.translation.direction);
        if (residual > inlier_threshold || pair.current.match_error > 2.5F) continue;
        error_sum += residual * focal;
        const Vec3 rotated = normalize(transform(selected.rotation, pair.reference_bearing));
        const float cosine = std::max(-1.0F, std::min(1.0F, dot(rotated, pair.current_bearing)));
        parallax.push_back(std::acos(cosine) * kRadToDeg);
        normalized_motion.push_back(std::hypot(pair.current.x - pair.reference.x,
                                               pair.current.y - pair.reference.y) / focal);
    }
    const float baseline = std::max(0.004F, std::min(0.15F,
        median(normalized_motion) * current.camera.scale_meters_per_unit));
    result.pose = compose_pose(world_from_reference, selected.rotation,
                               multiply(selected.translation.direction, baseline));
    result.parallax_degrees = median(parallax);
    result.reprojection_error_pixels = error_sum / float(result.inliers);
    result.rotation_degrees = selected.rotation_degrees;
    result.translation_observability = selected.translation.observability;
    const float inlier_support = float(result.inliers) / float(std::max<std::size_t>(40U, result.matches));
    result.tracking_confidence = clamp01(inlier_support * (0.55F + 0.45F * selected.translation.observability));
    result.degenerate = selected.translation.observability < 0.005F || result.parallax_degrees < 0.08F;
    result.recovered = !result.degenerate && result.tracking_confidence >= 0.15F &&
        std::isfinite(result.reprojection_error_pixels);
    result.receipt = v26_detail::pose_receipt(result, reference, current);
    return result;
}

} // namespace keyxym
