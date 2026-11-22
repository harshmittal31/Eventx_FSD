const validateVenueLayout = (layout) => {
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
        return { error: "venueLayout must be an object" };
    }

    const { rows, seatsPerRow, sections } = layout;

    if (!Number.isInteger(rows) || rows < 1 || rows > 26) {
        return { error: "venueLayout.rows must be an integer from 1 to 26" };
    }

    if (!Number.isInteger(seatsPerRow) || seatsPerRow < 1 || seatsPerRow > 50) {
        return {
            error: "venueLayout.seatsPerRow must be an integer from 1 to 50"
        };
    }

    if (!Array.isArray(sections) || sections.length === 0) {
        return { error: "venueLayout.sections must be a non-empty array" };
    }

    const rowLabels = Array.from(
        { length: rows },
        (_, index) => String.fromCharCode(65 + index)
    );
    const assignedRows = [];
    const normalizedSections = [];

    for (const section of sections) {
        if (
            !section ||
            typeof section !== "object" ||
            Array.isArray(section) ||
            typeof section.name !== "string" ||
            !section.name.trim()
        ) {
            return { error: "Each venue section must have a non-empty name" };
        }

        if (!Array.isArray(section.rows) || section.rows.length === 0) {
            return {
                error: `Section ${section.name} must include at least one row`
            };
        }

        if (
            typeof section.price !== "number" ||
            !Number.isFinite(section.price) ||
            section.price <= 0
        ) {
            return {
                error: `Section ${section.name} must have a positive numeric price`
            };
        }

        for (const row of section.rows) {
            if (!rowLabels.includes(row)) {
                return {
                    error: `Section ${section.name} contains an invalid row`
                };
            }
            assignedRows.push(row);
        }

        normalizedSections.push({
            name: section.name.trim(),
            rows: [...section.rows],
            price: section.price
        });
    }

    if (
        assignedRows.length !== rows ||
        new Set(assignedRows).size !== rows ||
        rowLabels.some(row => !assignedRows.includes(row))
    ) {
        return {
            error: "Venue sections must cover every row exactly once"
        };
    }

    return {
        layout: {
            rows,
            seatsPerRow,
            sections: normalizedSections
        }
    };
};

module.exports = validateVenueLayout;
