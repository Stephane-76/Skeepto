//=============================================================================
// SkCellClassContainer
// Class container
//=============================================================================


import SkCellClassButton from "./SkCellClassButton.js";
import SkCellClassCheck from "./SkCellClassCheck.js";
import SkCellClassSwitch from "./SkCellClassSwitch.js";
import SkCellClassCalendar from "./SkCellClassCalendar.js";
import SkCellClassCanvas from "./SkCellClassCanvas.js";
import SkCellClassComboBox from "./SkCellClassComboBox.js";
import SkCellClassPieChart from "./SkCellClassPieChart.js";
import SkCellClassLineChart from "./SkCellClassLineChart.js";
import SkCellClassGauge from "./SkCellClassGauge.js";
import SkCellClassSparkline from "./SkCellClassSparkline.js";
import SkCellClassImage from "./SkCellClassImage.js";
import SkCellClassTextBox from "./SkCellClassTextBox.js";
// The WASM engine keeps a process-wide tClassFactory singleton, so cell classes
// stay registered across React navigations. Track the engine we registered
// against to avoid redundant re-registration (which the C++ side reports as an
// "already registered" failure and floods the console with false errors).
let gRegisteredEngine = null;

class SkCellClassContainer {
    constructor() {
        this.RegisterClasses();
    }

    RegisterClasses() {
        // CRITICAL: Verify window.SkUISpreadSheet is defined before registering classes
        if (!window.SkUISpreadSheet) {
            console.error('[SkCellClassContainer] window.SkUISpreadSheet is undefined! Cannot register classes.');
            console.error('[SkCellClassContainer] This should not happen if loadWebAssembly() waits for loadUI()');
            return;
        }

        // Skip if these classes were already registered against this engine instance.
        if (gRegisteredEngine === window.SkUISpreadSheet) {
            return;
        }

        console.log('[SkCellClassContainer] Registering cell classes with SkUISpreadSheet...');
        SkCellClassCanvas.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassCheck.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassSwitch.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassCalendar.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassButton.registerClassAttribute( window.SkUISpreadSheet);   
        SkCellClassComboBox.registerClassAttribute( window.SkUISpreadSheet);  
        SkCellClassPieChart.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassLineChart.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassGauge.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassSparkline.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassImage.registerClassAttribute( window.SkUISpreadSheet);
        SkCellClassTextBox.registerClassAttribute( window.SkUISpreadSheet);
        gRegisteredEngine = window.SkUISpreadSheet;
        console.log('[SkCellClassContainer] All cell classes registered successfully');
    }
}


// ============================================================================
export default SkCellClassContainer;