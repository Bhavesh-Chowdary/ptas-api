export const generateActivityMessage = (log) => {
    const { entity_type, action, after_data, before_data, entity_id } = log;

    const entityName = after_data?.title || after_data?.name || before_data?.title || before_data?.name || entity_id;

    const idTag = log.after_data?.task_code || log.after_data?.project_code || log.entity_id;
    const prefix = idTag ? `#${idTag} ` : '';

    if (entity_type === 'task') {
        if (action === 'created') return `${prefix}Created task ${entityName}`;
        if (action === 'deleted') return `${prefix}Deleted task ${entityName}`;
        if (action === 'updated') {
            if (before_data?.status !== after_data?.status) {
                if (after_data?.status === 'done') return `${prefix}Completed task ${entityName}`;
                if (after_data?.status === 'in_progress') return `${prefix}Started task ${entityName}`;
                return `${prefix}Moved task ${entityName} to ${after_data.status.replace('_', ' ')}`;
            }
            return `${prefix}Updated task ${entityName}`;
        }
    }

    if (entity_type === 'project') {
        if (action === 'created') return `${prefix}Created project ${entityName}`;
        if (action === 'updated') return `${prefix}Updated project ${entityName}`;
        if (action === 'deleted') return `${prefix}Deleted project ${entityName}`;
    }

    if (entity_type === 'module') {
        if (action === 'created') return `${prefix}Added module ${entityName} to project`;
        if (action === 'updated') return `${prefix}Updated module ${entityName}`;
        if (action === 'deleted') return `${prefix}Removed module ${entityName}`;
    }

    if (entity_type === 'sprint') {
        if (action === 'created') return `${prefix}Created sprint ${entityName}`;
        if (action === 'updated') {
            if (before_data?.status !== after_data?.status) {
                return `${prefix}Sprint ${entityName} is now ${after_data.status}`;
            }
            return `${prefix}Updated sprint ${entityName}`;
        }
        if (action === 'deleted') return `${prefix}Deleted sprint ${entityName}`;
    }

    return `${prefix}${action.charAt(0).toUpperCase() + action.slice(1)} ${entity_type} ${entityName}`;
};
