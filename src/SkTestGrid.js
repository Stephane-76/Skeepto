import React from 'react';
import { SkGrid } from './component/SkGrid';
import { SkButton } from './component/SkButton';

export class SkTestGrid extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            selectedRow: null,
            readOnly: true
        };

        // Example data structure
        this.m_data = {
            columns: [
                { m_Label: 'ID', m_Name: 'id', m_Width: '80px', m_TypeField: 'integer' },
                { m_Label: 'Last name', m_Name: 'name', m_Width: '150px', m_TypeField: 'string' },
                { m_Label: 'First name', m_Name: 'firstName', m_Width: '150px', m_TypeField: 'string' },
                { m_Label: 'Date', m_Name: 'date', m_Width: '120px', m_TypeField: 'date' },
                { m_Label: 'Salary', m_Name: 'salary', m_Width: '120px', m_TypeField: 'float', decimals: 2 },
                { m_Label: 'Email', m_Name: 'email', m_Width: '200px', m_TypeField: 'string' },
                { m_Label: 'Phone', m_Name: 'phone', m_Width: '120px', m_TypeField: 'string' },
                { m_Label: 'City', m_Name: 'city', m_Width: '120px', m_TypeField: 'string' },
                { m_Label: 'Status', m_Name: 'status', m_Width: '100px', m_TypeField: 'string' }
            ],
            data: [
                { 
                    id: 1, 
                    name: 'Dupont', 
                    firstName: 'Jean',
                    date: '1980-05-15',
                    salary: 3500.50,
                    email: 'jean.dupont@example.com',
                    phone: '01 23 45 67 89',
                    city: 'Paris',
                    status: 'Active'
                },
                { 
                    id: 2, 
                    name: 'Martin', 
                    firstName: 'Sophie',
                    date: '1985-08-22',
                    salary: 4200.75,
                    email: 'sophie.martin@example.com',
                    phone: '02 34 56 78 90',
                    city: 'Lyon',
                    status: 'Inactive'
                },
                { 
                    id: 3, 
                    name: 'Bernard', 
                    firstName: 'Pierre',
                    date: '1978-03-10',
                    salary: 3800.25,
                    email: 'pierre.bernard@example.com',
                    phone: '03 45 67 89 01',
                    city: 'Marseille',
                    status: 'Active'
                },
                { 
                    id: 4, 
                    name: 'Petit', 
                    firstName: 'Marie',
                    date: '1990-11-30',
                    salary: 2950.00,
                    email: 'marie.petit@example.com',
                    phone: '04 56 78 90 12',
                    city: 'Bordeaux',
                    status: 'Pending'
                },
                { 
                    id: 5, 
                    name: 'Robert', 
                    firstName: 'Thomas',
                    date: '1982-07-18',
                    salary: 4100.50,
                    email: 'thomas.robert@example.com',
                    phone: '05 67 89 01 23',
                    city: 'Lille',
                    status: 'Active'
                },
                { 
                    id: 6, 
                    name: 'Dubois', 
                    firstName: 'Claire',
                    date: '1987-04-25',
                    salary: 3650.75,
                    email: 'claire.dubois@example.com',
                    phone: '06 78 90 12 34',
                    city: 'Toulouse',
                    status: 'Active'
                },
                { 
                    id: 7, 
                    name: 'Leroy', 
                    firstName: 'Paul',
                    date: '1975-09-12',
                    salary: 4500.00,
                    email: 'paul.leroy@example.com',
                    phone: '07 89 01 23 45',
                    city: 'Nantes',
                    status: 'Inactive'
                },
                { 
                    id: 8, 
                    name: 'Moreau', 
                    firstName: 'Julie',
                    date: '1992-01-20',
                    salary: 3200.25,
                    email: 'julie.moreau@example.com',
                    phone: '08 90 12 34 56',
                    city: 'Strasbourg',
                    status: 'Active'
                },
                { 
                    id: 9, 
                    name: 'Simon', 
                    firstName: 'Lucas',
                    date: '1988-12-05',
                    salary: 3400.50,
                    email: 'lucas.simon@example.com',
                    phone: '09 01 23 45 67',
                    city: 'Montpellier',
                    status: 'Pending'
                },
                { 
                    id: 10, 
                    name: 'Michel', 
                    firstName: 'Emma',
                    date: '1995-06-28',
                    salary: 2800.00,
                    email: 'emma.michel@example.com',
                    phone: '01 12 34 56 78',
                    city: 'Nice',
                    status: 'Active'
                },
                { 
                    id: 11, 
                    name: 'Laurent', 
                    firstName: 'Antoine',
                    date: '1983-02-14',
                    salary: 3950.75,
                    email: 'antoine.laurent@example.com',
                    phone: '02 23 45 67 89',
                    city: 'Rennes',
                    status: 'Inactive'
                },
                { 
                    id: 12, 
                    name: 'Lefebvre', 
                    firstName: 'Camille',
                    date: '1991-10-08',
                    salary: 3300.25,
                    email: 'camille.lefebvre@example.com',
                    phone: '03 34 56 78 90',
                    city: 'Grenoble',
                    status: 'Active'
                },
                { 
                    id: 13, 
                    name: 'Garcia', 
                    firstName: 'Hugo',
                    date: '1986-07-22',
                    salary: 3750.50,
                    email: 'hugo.garcia@example.com',
                    phone: '04 45 67 89 01',
                    city: 'Dijon',
                    status: 'Pending'
                },
                { 
                    id: 14, 
                    name: 'Roux', 
                    firstName: 'Léa',
                    date: '1993-03-15',
                    salary: 3100.00,
                    email: 'lea.roux@example.com',
                    phone: '05 56 78 90 12',
                    city: 'Angers',
                    status: 'Active'
                },
                { 
                    id: 15, 
                    name: 'Fournier', 
                    firstName: 'Maxime',
                    date: '1981-11-30',
                    salary: 4050.75,
                    email: 'maxime.fournier@example.com',
                    phone: '06 67 89 01 23',
                    city: 'Tours',
                    status: 'Inactive'
                },
                { 
                    id: 16, 
                    name: 'Girard', 
                    firstName: 'Sarah',
                    date: '1989-05-17',
                    salary: 3550.25,
                    email: 'sarah.girard@example.com',
                    phone: '07 78 90 12 34',
                    city: 'Reims',
                    status: 'Active'
                },
                { 
                    id: 17, 
                    name: 'Bonnet', 
                    firstName: 'Nicolas',
                    date: '1977-08-09',
                    salary: 4300.00,
                    email: 'nicolas.bonnet@example.com',
                    phone: '08 89 01 23 45',
                    city: 'Le Havre',
                    status: 'Inactive'
                },
                { 
                    id: 18, 
                    name: 'Dupuis', 
                    firstName: 'Laura',
                    date: '1994-04-03',
                    salary: 3000.50,
                    email: 'laura.dupuis@example.com',
                    phone: '09 90 12 34 56',
                    city: 'Saint-Étienne',
                    status: 'Active'
                },
                { 
                    id: 19, 
                    name: 'Lambert', 
                    firstName: 'Alexandre',
                    date: '1984-12-21',
                    salary: 3850.75,
                    email: 'alexandre.lambert@example.com',
                    phone: '01 01 23 45 67',
                    city: 'Toulon',
                    status: 'Pending'
                },
                { 
                    id: 20, 
                    name: 'Fontaine', 
                    firstName: 'Chloé',
                    date: '1996-09-14',
                    salary: 2900.00,
                    email: 'chloe.fontaine@example.com',
                    phone: '02 12 34 56 78',
                    city: 'Limoges',
                    status: 'Active'
                },
                { 
                    id: 21, 
                    name: 'Rousseau', 
                    firstName: 'Quentin',
                    date: '1982-06-27',
                    salary: 4000.25,
                    email: 'quentin.rousseau@example.com',
                    phone: '03 23 45 67 89',
                    city: 'Amiens',
                    status: 'Inactive'
                },
                { 
                    id: 22, 
                    name: 'Vincent', 
                    firstName: 'Manon',
                    date: '1990-01-08',
                    salary: 3450.50,
                    email: 'manon.vincent@example.com',
                    phone: '04 34 56 78 90',
                    city: 'Perpignan',
                    status: 'Active'
                },
                { 
                    id: 23, 
                    name: 'Muller', 
                    firstName: 'Romain',
                    date: '1987-10-19',
                    salary: 3700.75,
                    email: 'romain.muller@example.com',
                    phone: '05 45 67 89 01',
                    city: 'Metz',
                    status: 'Pending'
                },
                { 
                    id: 24, 
                    name: 'Lefevre', 
                    firstName: 'Inès',
                    date: '1993-07-31',
                    salary: 3150.00,
                    email: 'ines.lefevre@example.com',
                    phone: '06 56 78 90 12',
                    city: 'Besançon',
                    status: 'Active'
                },
                { 
                    id: 25, 
                    name: 'Faure', 
                    firstName: 'Théo',
                    date: '1985-03-25',
                    salary: 3900.25,
                    email: 'theo.faure@example.com',
                    phone: '07 67 89 01 23',
                    city: 'Orléans',
                    status: 'Inactive'
                }
            ]
        };
    }

    onCellEdit = (rowIndex, columnField, newValue) => {
        console.log('Cell edited:', rowIndex, columnField, newValue);
        // Update the data
        const newData = [...this.m_data.data];
        newData[rowIndex] = {
            ...newData[rowIndex],
            [columnField]: newValue
        };
        this.m_data.data = newData;
        // Force a re-render
        this.forceUpdate();
    }

    handleEditClick = (rowIndex) => {
        console.log('Edit clicked for row:', rowIndex);
        // Add the logic here to open an edit form
        // or run any other edit-related action
    }

    handleDeleteClick = (rowIndex) => {
        console.log('Delete clicked for row:', rowIndex);
        // Remove the row from the data
        const newData = [...this.m_data.data];
        newData.splice(rowIndex, 1);
        this.m_data.data = newData;
        this.forceUpdate(); // Force a re-render
    }

    handleRowSelect = (row) => {
        this.setState({ selectedRow: row });
        console.log('Row selected:', row);
    }

    toggleReadOnly = () => {
        this.setState({ readOnly: !this.state.readOnly });
    }

    render() {
        return (
            <div className="sk-test-grid" style={{ height: '100vh' }}>
                 <div className="SkTestGridControls">
                    <SkButton
                        style={{
                            minWidth: '100px',
                            border: '1px solid black',
                            visibility: 'hidden'
                        }}
                        onClick={this.toggleReadOnly}>
                        {this.state.readOnly ? 'Read-only' : 'Edit'}
                    </SkButton>
                </div>
                <SkGrid 
                    style={{
                        width: '100%',
                        height: '50%',
                    }}
                    readOnly={this.state.readOnly}
                    columns={this.m_data.columns}
                    data={this.m_data.data}
                    onRowSelect={this.handleRowSelect}
                    selectedRow={this.state.selectedRow}
                    onCellEdit={this.onCellEdit}
                    onEdit={this.handleEditClick}
                    onDelete={this.handleDeleteClick}
                />
            </div>
        );
    }
}

export default SkTestGrid;