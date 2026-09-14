//=============================================================================
// SkFillData.mjs
// Initialize example data for Users and Groups tables
// Author Stéphane ALLEZ 08/08/2024
//=============================================================================

import { SkWebInterface } from "./SkWebInterface.mjs"

// Utility function to add delay between operations
function delay(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

// Initialize groups with example data
async function InitializeGroups(wSkWebInterface) {
    console.log("Initializing groups...");
    
    const groups = [
        {
            Code: 'admin',
            Label: 'Administrator',
        },
        {
            Code: 'developer',
            Label: 'Developer',
        },
        {
            Code: 'user',
            Label: 'Standard User',
        },
        {
            Code: 'guest',
            Label: 'Guest',
        }
    ];

    for (const group of groups) {
        try {
            const result = await wSkWebInterface.postJson("/mdb/Group", JSON.stringify(group));
            if (result?.message === 'error') {
                throw new Error(result.error || 'Group insert failed');
            }
            console.log(`Group ${group.Code} created:`, result);
            await delay(100); // Small delay between operations
        } catch (error) {
            console.error(`Error creating group ${group.Code}:`, error);
        }
    }
}

// Initialize users with example data
async function InitializeUsers(wSkWebInterface) {
    console.log("Initializing users...");
    
    const users = [
        {
            Name: '#admin',
            FirstName: 'Administrator',
            Email: 'admin@sker.com',
            Group: 'admin',
            Date: Date.now(),
            Password: 'Il fait beau a rouen'
        },
        {
            Name: 'Allez',
            FirstName: 'Stéphane',
            Email: 'sallez@toto.fr',
            Group: 'admin',
            Date: Date.now(),
            Password: 'sallez'
        },
       
        {
            Name: 'Guest',
            FirstName: 'Guest',
            Email: 'guest@skeema.fr',
            Group: 'guest',
            Date: Date.now(),
            Password: 'guest'
        }
    ];

    for (const user of users) {
        try {
            const result = await wSkWebInterface.postJson("/mdb/User", JSON.stringify(user));
            if (result?.message === 'error') {
                throw new Error(result.error || 'User insert failed');
            }
            console.log(`User ${user.Email} created:`, result);
            await delay(100); // Small delay between operations
        } catch (error) {
            console.error(`Error creating user ${user.Email}:`, error);
        }
    }
}

// Initialize relationship types catalog
async function InitializeRelationshipTypes(wSkWebInterface) {
    console.log("Initializing relationship types...");

    const relationshipTypes = [
        {
            Code: 'memberOf',
            Label: 'Member of',
            FromTypes: 'User',
            ToTypes: 'Group'
        },
        {
            Code: 'references',
            Label: 'References',
            FromTypes: '*',
            ToTypes: '*'
        }
    ];

    for (const relType of relationshipTypes) {
        try {
            const result = await wSkWebInterface.postJson("/mdb/RelationshipType", JSON.stringify(relType));
            console.log(`RelationshipType ${relType.Code} created:`, result);
            await delay(100);
        } catch (error) {
            console.error(`Error creating relationship type ${relType.Code}:`, error);
        }
    }
}

// Main function to initialize all data
export async function fillData() {
    const wHttpAdr = process.env.SKER_SERVER_URL || 'http://127.0.0.1:8000';
    const wEmail = process.env.SKER_ADMIN_EMAIL || 'admin@sker.com';
    const wPassword = process.env.SKER_ADMIN_PASSWORD || 'Il fait beau a rouen';

    try {
        // Initialize web interface
        const wSkWebInterface = new SkWebInterface(wHttpAdr);
        
        // First, authenticate with the server to get a valid token
        console.log("Authenticating with server...");
        const authResult = await authenticateWithServer(wHttpAdr, wEmail, wPassword);
        
        if (authResult.success) {
            // Set the authentication token
            wSkWebInterface.setAuthToken(wEmail, authResult.token);
            console.log("Authentication successful, proceeding with data initialization...");
            
            // Initialize groups, relationship types and users
            await InitializeGroups(wSkWebInterface);
            await InitializeRelationshipTypes(wSkWebInterface);
            await InitializeUsers(wSkWebInterface);

            console.log("Data initialization completed successfully");
        } else {
            console.error("Authentication failed:", authResult.error);
        }
    } catch (error) {
        console.error("Error during data initialization:", error);
    }
}

// Function to authenticate with the server
async function authenticateWithServer(serverUrl, email, password) {
    try {
        const response = await fetch(`${serverUrl}/login`, {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                password: password,
            })
        });

        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const data = await response.json();
        if (data.token) {
            return { success: true, token: data.token };
        } else {
            return { success: false, error: "No token received from server" };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// If this file is run directly, execute the initialization
if (import.meta.url === `file://${process.argv[1]}`) {
    fillData();
} 

export default fillData;