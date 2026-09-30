// Synthetic Invalid Script for Gate B Failure Boundary Verification
// Contains intentional syntax error to test parser/runtime failure handling

function main(config, profileName) {
    this is an intentional syntax error that cannot be parsed by Boa !!!
    return config;
}
