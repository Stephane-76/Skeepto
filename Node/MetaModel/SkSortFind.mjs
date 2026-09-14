// ============================================================================
// Meta model Sker Sort & find function
// Using Client or Server
// Author Stéphane ALLEZ le 19/08/2024
// ============================================================================

function DynamicSort(property) {
    var sortOrder = 1;
    if(property[0] === "-") {
        sortOrder = -1;
        property = property.substr(1);
    }
    return function (a,b) {
        /* next line works with strings and numbers, 
         * and you may want to customize it to your needs
         */
        var result = (a[property] < b[property]) ? -1 : (a[property] > b[property]) ? 1 : 0;
        return result * sortOrder;
    }
}

function DynamicSortMultiple() {
    /*
     * save the arguments object as it will be overwritten
     * note that arguments object is an array-like object
     * consisting of the names of the properties to sort by
     */
    var props = arguments;
    return function (obj1, obj2) {
        var i = 0, result = 0, numberOfProperties = props.length;
        /* try getting a different result from 0 (equal)
         * as long as we have extra properties to compare
         */
        while(result === 0 && i < numberOfProperties) {
            result = DynamicSort(props[i])(obj1, obj2);
            i++;
        }
        return result;
    }
}

export class SkObjectArray extends Array {
    SortBy(...args) {
        return this.sort(DynamicSortMultiple(...args));
    }
    
    Sort(sItem) {
        return this.sort(DynamicSort(sItem))
    }

    Find(sProperty,sValue) {
        let wResult=this.filter((sItem) =>  
            (sItem[sProperty]===sValue))
        return(wResult)
    }
}

