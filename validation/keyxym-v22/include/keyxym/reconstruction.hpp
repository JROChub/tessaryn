#pragma once
#include "types.hpp"
#include "provenance.hpp"
#include <array>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace keyxym {

struct CameraIntrinsics {
    std::uint32_t width{}, height{};
    float fx{}, fy{}, cx{}, cy{};
    float depth_scale_m{0.001F};
};

struct RigidPose {
    // Row-major rigid transform from camera coordinates into world coordinates.
    std::array<float, 16> world_from_camera{1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
};

struct RGBDFrame {
    std::uint64_t timestamp_ns{};
    CameraIntrinsics intrinsics;
    RigidPose pose;
    std::vector<std::uint16_t> depth;
    std::vector<Byte> rgba;
    std::vector<Byte> privacy_mask;
};

struct CaptureManifest {
    std::string source_id;
    std::vector<RGBDFrame> frames;
    Hash256 source_commitment{};
};

struct CaptureLimits {
    std::uint32_t max_width{8192};
    std::uint32_t max_height{8192};
    std::uint64_t max_pixels{64ULL * 1024ULL * 1024ULL};
    std::size_t max_frames{4096};
};

struct CaptureValidation { bool valid{}; std::string error; };
CaptureValidation validate_capture(const CaptureManifest&, const CaptureLimits& = {});
Hash256 compute_capture_commitment(const CaptureManifest&);

struct ReconstructionConfig {
    float min_depth_m{0.10F};
    float max_depth_m{100.0F};
    float voxel_size_m{0.02F};
    float sdf_truncation_m{0.06F};
    std::size_t moment_frame_span{8};
};

struct SparseSdfVoxel {
    std::int32_t x{}, y{}, z{};
    float signed_distance{};
    float weight{};
};

struct ReconstructionResult {
    std::vector<Surfel> surfels;
    std::vector<SparseSdfVoxel> sparse_sdf;
    std::vector<Moment> moments;
    Hash256 replay_hash{};
};

CaptureValidation validate_reconstruction_config(const ReconstructionConfig&);
ReconstructionResult reconstruct_capture(const CaptureManifest&, const ReconstructionConfig& = {});
Hash256 compute_replay_hash(const CaptureManifest&, const ReconstructionConfig&, const ReconstructionResult&);

struct BranchRecord {
    Hash256 parent_rootprint{};
    Hash256 capture_commitment{};
    Hash256 replay_hash{};
    Hash256 branch_id{};
};
BranchRecord make_branch_record(const Hash256& parent, const Hash256& capture, const Hash256& replay);

class SecureBytes {
public:
    SecureBytes() = default;
    explicit SecureBytes(std::vector<Byte> bytes) : bytes_(std::move(bytes)) {}
    SecureBytes(const SecureBytes&) = delete;
    SecureBytes& operator=(const SecureBytes&) = delete;
    SecureBytes(SecureBytes&&) noexcept;
    SecureBytes& operator=(SecureBytes&&) noexcept;
    ~SecureBytes();
    const std::vector<Byte>& view() const noexcept { return bytes_; }
    bool empty() const noexcept { return bytes_.empty(); }
    void clear() noexcept;
private:
    std::vector<Byte> bytes_;
};

struct SignedImportManifest {
    std::string protocol{"keyxym/tessaryn-import/v1"};
    Hash256 artifact_digest{};
    Hash256 tessaryn_rootprint{};
    Hash256 tessaryn_pha{};
    Hash256 tessaryn_memory_capsule{};
    Hash256 keyxym_capture_commitment{};
    std::uint64_t verified_unix_ms{};
    Hash256 manifest_hash{};
    Signature signature{};
};
Hash256 compute_import_manifest_hash(const SignedImportManifest&);
SignedImportManifest sign_import_manifest(SignedImportManifest, const SignatureProvider&, const SecureBytes& private_key);
bool verify_import_manifest(const SignedImportManifest&, const SignatureProvider&, const std::vector<Byte>& public_key);

} // namespace keyxym
