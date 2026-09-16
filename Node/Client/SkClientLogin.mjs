//=============================================================================
// SkClient.mjs
// Client for Test SkServer 
// Author Stéphane ALLEZ 08/08/2024
//=============================================================================
import { JSONStorage, LocalStorage } from "node-localstorage"

let wHttpAdr = "http://localhost:8000";
let wEmail = "sallez@toto.fr";

export async function SkLogin(sHttpAdr,sEmail,sPassWord) {
    let wOptions = {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json', // Indicate that the request body contains JSON
        },
        body: JSON.stringify({
            email: sEmail, // Use the defined variable for email
            password: sPassWord,
        })
    };

    try {
        let wUri = sHttpAdr;
        const wLoginResponse = await fetch(wUri + "/login", wOptions);
        
        if (!wLoginResponse.ok) {
            throw new Error(`Login ${wUri}/login : Response status: ${wLoginResponse.status}`);
        }

        const wJsonLoginResponse = await wLoginResponse.json(); // Read the response as JSON
        //console.log('Login response:', wJsonLoginResponse.token); // Display the received token

        const wToken = wJsonLoginResponse.token;

        // Use the token to access the protected route
        const wProtectedResponse = await fetch(wUri + '/protected', {
            headers: {
                Authorization: `Bearer ${wToken}` // Add the authentication token
            }
        });

        if (!wProtectedResponse.ok) {
            throw new Error(`Protected route ${wUri}/protected : Response status: ${wProtectedResponse.status}`);
        }

        const wJsonProtectedResponse = await wProtectedResponse.json(); // Read the response as JSON
        //console.log('Protected response:', wJsonProtectedResponse); // Display the protected response

        global.localStorage.setItem("user", JSON.stringify({ "user": sEmail, token: wToken}))
        global.localStorage.setItem("jwt",  wToken)

    } catch (error) {
        console.error('Error: ', error.message); // Display any errors
    }
}

