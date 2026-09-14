// ============================================================================
// Depency container for injection Code
// Author Stéphane ALLEZ le 11/09/2024
// ============================================================================

export class SkDependencyContainer {
    constructor() {
        this.dependencies = {};
    }

    // Method to register dependencies with the container
    register(name, dependency) {
        this.dependencies[name] = dependency;
    }

    // Method to resolve dependencies by name
    resolve(name) {
        if (!(name in this.dependencies)) {
            throw new Error(`❌ Dependency '${name}' not registered.`);
        }
        return this.dependencies[name];
    }

    // Method to get a dependency by name
    get(name) {
        return this.resolve(name);
    }
}

export default SkDependencyContainer