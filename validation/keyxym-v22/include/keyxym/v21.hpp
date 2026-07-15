#pragma once

#include "reconstruction.hpp"
#include "v20.hpp"

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace keyxym {

struct LandmarkObservation {
    std::uint32_t id{};
    std::array<float, 3> point{};
    float confidence{1.0F};
};

struct SpatialFrame {
    Timestamp timestamp{};
    CameraIntrinsics intrinsics;
    std::vector<float> depth_meters;
    std::vector<std::array<float, 3>> rgb;
    std::vector<LandmarkObservation> landmarks;
    Hash256 source_commitment{};
};

struct PoseRecoveryResult {
    bool recovered{false};
    RigidPose pose;
    std::size_t correspondences{};
    float rms_error{};
    Hash256 receipt{};
};

PoseRecoveryResult recover_camera_pose(const std::vector<LandmarkObservation>& reference,
                                        const std::vector<LandmarkObservation>& current,
                                        std::size_t minimum_correspondences = 3);

struct ReconstructionLimits {
    float voxel_size_meters{0.02F};
    float minimum_depth_meters{0.08F};
    float maximum_depth_meters{20.0F};
    float minimum_confidence{0.05F};
    std::uint64_t maximum_surfels{5'000'000};
};

struct ReconstructionReceipt {
    std::string backend;
    std::string device;
    std::uint64_t input_samples{};
    std::uint64_t output_surfels{};
    std::uint64_t elapsed_nanoseconds{};
    bool hardware_executed{false};
    bool deterministic{true};
    Hash256 input_commitment{};
    Hash256 output_commitment{};
    Hash256 receipt{};
};

class SpatialReconstructionBackend {
public:
    virtual ~SpatialReconstructionBackend() = default;
    virtual ReconstructionReceipt reconstruct(const SpatialFrame& frame,
                                                const RigidPose& pose,
                                                const ReconstructionLimits& limits,
                                                std::vector<Surfel>& output) = 0;
};

class CpuSpatialReconstruction final : public SpatialReconstructionBackend {
public:
    ReconstructionReceipt reconstruct(const SpatialFrame& frame,
                                        const RigidPose& pose,
                                        const ReconstructionLimits& limits,
                                        std::vector<Surfel>& output) override;
};

struct WebGpuDispatch {
    CameraIntrinsics intrinsics;
    RigidPose pose;
    ReconstructionLimits limits;
    const SpatialFrame* frame{};
};

class WebGpuExecutor {
public:
    virtual ~WebGpuExecutor() = default;
    virtual std::string adapter_name() const = 0;
    virtual bool dispatch(const WebGpuDispatch& dispatch,
                          std::vector<Surfel>& output,
                          std::uint64_t& elapsed_nanoseconds) = 0;
};

class WebGpuSpatialReconstruction final : public SpatialReconstructionBackend {
public:
    explicit WebGpuSpatialReconstruction(std::shared_ptr<WebGpuExecutor> executor);
    ReconstructionReceipt reconstruct(const SpatialFrame& frame,
                                        const RigidPose& pose,
                                        const ReconstructionLimits& limits,
                                        std::vector<Surfel>& output) override;
private:
    std::shared_ptr<WebGpuExecutor> executor_;
};

struct NeuromorphicEvent {
    std::uint16_t x{}, y{};
    bool polarity{};
    std::uint64_t hardware_timestamp_ns{};
    float confidence{1.0F};
};

struct NeuromorphicPacket {
    std::string device_id;
    CameraIntrinsics intrinsics;
    RigidPose pose;
    std::vector<NeuromorphicEvent> events;
    Hash256 hardware_receipt{};
};

class NeuromorphicHardwareDevice {
public:
    virtual ~NeuromorphicHardwareDevice() = default;
    virtual std::string device_id() const = 0;
    virtual bool read_packet(NeuromorphicPacket& packet) = 0;
};

class NeuromorphicSpatialReconstruction {
public:
    explicit NeuromorphicSpatialReconstruction(std::shared_ptr<NeuromorphicHardwareDevice> device);
    ReconstructionReceipt capture(const ReconstructionLimits& limits,
                                  std::vector<Surfel>& accumulated);
private:
    std::shared_ptr<NeuromorphicHardwareDevice> device_;
};

struct TheaterPoint {
    float x{}, y{}, z{};
    float r{}, g{}, b{};
    float confidence{};
};

struct TheaterFrame {
    std::string cell_id;
    std::string branch;
    std::size_t active_moment{};
    std::vector<TheaterPoint> points;
    Hash256 rootprint{};
    bool verified{false};
};

TheaterFrame render_world_cell_theater(const FormalWorldCell& cell,
                                       std::size_t active_moment,
                                       const SignatureProvider* provider = nullptr,
                                       const std::vector<Byte>* public_key = nullptr);

class SpatialCaptureSession {
public:
    SpatialCaptureSession(std::string branch,
                          ReconstructionLimits limits = {},
                          std::shared_ptr<SpatialReconstructionBackend> backend = {});
    PoseRecoveryResult ingest_frame(const SpatialFrame& frame);
    ReconstructionReceipt last_reconstruction_receipt() const;
    FormalMoment commit_moment(std::string id, Hash256 evidence = {});
    FormalWorldCell build_world_cell(Hash256 pha, Hash256 memory_capsule,
                                     Hash256 parent_rootprint = {}) const;
    const std::vector<Surfel>& geometry() const noexcept;
private:
    std::string branch_;
    ReconstructionLimits limits_;
    std::shared_ptr<SpatialReconstructionBackend> backend_;
    std::vector<LandmarkObservation> reference_landmarks_;
    RigidPose last_pose_;
    std::vector<Surfel> geometry_;
    std::vector<FormalMoment> moments_;
    ReconstructionReceipt last_receipt_;
};

struct WorldCellTransferManifest {
    Hash256 cell_rootprint{};
    Hash256 canonical_digest{};
    std::uint64_t total_bytes{};
    std::uint32_t chunk_size{};
    std::vector<Hash256> chunk_digests;
};

struct WorldCellTransferBundle {
    WorldCellTransferManifest manifest;
    std::vector<std::vector<Byte>> chunks;
};

WorldCellTransferBundle package_world_cell_transfer(const FormalWorldCell& cell,
                                                    std::uint32_t chunk_size = 256U * 1024U);
FormalWorldCell reconstruct_transferred_world_cell(const WorldCellTransferBundle& bundle,
                                                   const FormalLimits& limits = {});

} // namespace keyxym
