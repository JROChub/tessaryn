cmake_minimum_required(VERSION 3.20)
project(keyxym_v26_exact_validation VERSION 0.26.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
option(KEYXYM_VALIDATION_TESTS "Build exact browser authority validation tests" ON)

find_package(Threads REQUIRED)

set(KEYXYM_V22_EXACT_SOURCES
    src/sha256.cpp
    src/v20.cpp
    src/v22.cpp
    src/v22_c_api.cpp
    src/v22_browser_frontend.cpp
    src/v22_browser_runtime.cpp)
set(KEYXYM_V26_EXACT_SOURCES
    src/sha256.cpp
    src/v20.cpp
    src/v22.cpp
    src/v22_browser_frontend.cpp
    src/v26_pose.cpp
    src/v26_geometry.cpp
    src/v26_session.cpp
    src/v26_browser_runtime.cpp)

add_library(keyxym_v26_exact STATIC ${KEYXYM_V26_EXACT_SOURCES})
target_include_directories(keyxym_v26_exact PUBLIC include PRIVATE src)
target_link_libraries(keyxym_v26_exact PUBLIC Threads::Threads)
if(MSVC)
  target_compile_options(keyxym_v26_exact PRIVATE /W4 /permissive- /WX)
else()
  target_compile_options(keyxym_v26_exact PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

if(EMSCRIPTEN)
  add_executable(keyxym-v26 ${KEYXYM_V26_EXACT_SOURCES})
  target_include_directories(keyxym-v26 PRIVATE include src)
  target_compile_options(keyxym-v26 PRIVATE -Wall -Wextra -Wpedantic -Werror)
  target_link_options(keyxym-v26 PRIVATE
    -O3
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sENVIRONMENT=web,node,worker
    -sWASM_BIGINT=1
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=33554432
    -sMAXIMUM_MEMORY=536870912
    -sFILESYSTEM=0
    -sNO_EXIT_RUNTIME=1
    -sMALLOC=emmalloc
    -sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPF32','HEAPU32']
    -sEXPORTED_FUNCTIONS=['_malloc','_free','_keyxym_v26_session_create','_keyxym_v26_session_destroy','_keyxym_v26_ingest_rgba_packed','_keyxym_v26_copy_receipts','_keyxym_v26_copy_preview_packed','_keyxym_v26_geometry_revision','_keyxym_v26_copy_geometry_snapshot_packed','_keyxym_v26_quality_packed','_keyxym_v26_authority_packed','_keyxym_v26_status_message'])
  set_target_properties(keyxym-v26 PROPERTIES SUFFIX ".mjs")
elseif(KEYXYM_VALIDATION_TESTS)
  enable_testing()
  add_executable(keyxym_v22_frontend_test tests/test_v022_browser_frontend.cpp)
  target_link_libraries(keyxym_v22_frontend_test PRIVATE keyxym_v26_exact)
  add_test(NAME keyxym_v22_frontend_test COMMAND keyxym_v22_frontend_test)

  add_executable(keyxym_v26_test tests/test_v026.cpp)
  target_link_libraries(keyxym_v26_test PRIVATE keyxym_v26_exact)
  add_test(NAME keyxym_v26_test COMMAND keyxym_v26_test)

  add_executable(keyxym_v26_runtime_test tests/test_v026_browser_runtime.cpp)
  target_link_libraries(keyxym_v26_runtime_test PRIVATE keyxym_v26_exact)
  add_test(NAME keyxym_v26_runtime_test COMMAND keyxym_v26_runtime_test)
endif()

install(TARGETS keyxym_v26_exact ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION bin)
install(DIRECTORY include/keyxym DESTINATION include)
