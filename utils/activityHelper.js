export const generateActivityMessage = (log) => {
    const { entity_type, action, after_data, before_data, entity_id, user_name } = log;

    // Resolve name of the object (Task title, Project name, Sprint name, etc.)
    const entityName = after_data?.title || after_data?.name || before_data?.title || before_data?.name || '';

    // Fallback if name is missing (avoid UUID if possible)
    let displayName = entityName;
    if (!displayName) {
        if (entity_type === 'task') displayName = 'a task';
        else if (entity_type === 'project') displayName = 'a project';
        else if (entity_type === 'sprint') displayName = 'a sprint';
        else if (entity_type === 'module') displayName = 'a module';
        else displayName = entity_type || 'item';
    }

    const userName = user_name || "Someone";

    // Task Activities
    if (entity_type === 'task') {
        if (action === 'created') return `New task ${displayName} created by ${userName}`;
        if (action === 'deleted') return `Task ${displayName} deleted by ${userName}`;
        if (action === 'updated') {
            if (before_data?.status !== after_data?.status) {
                if (after_data?.status === 'done') return `Task ${displayName} completed by ${userName}`;
                if (after_data?.status === 'in_progress') return `Small progress made on ${displayName} by ${userName}`;
                return `${userName} moved ${displayName} to ${after_data.status.replace('_', ' ')}`;
            }
            return `Task ${displayName} updated by ${userName}`;
        }
    }

    // Project Activities
    if (entity_type === 'project') {
        if (action === 'created') return `New project ${displayName} has been created by ${userName}`;
        if (action === 'updated') return `Project ${displayName} was updated by ${userName}`;
        if (action === 'deleted') return `Project ${displayName} was deleted by ${userName}`;
    }

    // Module Activities
    if (entity_type === 'module') {
        if (action === 'created') return `New module ${displayName} added by ${userName}`;
        if (action === 'updated') return `Module ${displayName} updated by ${userName}`;
        if (action === 'deleted') return `Module ${displayName} removed by ${userName}`;
    }

    // Sprint Activities
    if (entity_type === 'sprint') {
        if (action === 'created') return `New sprint ${displayName} created by ${userName}`;
        if (action === 'updated') {
            if (before_data?.status !== after_data?.status) {
                const status = after_data?.status?.replace('_', ' ') || 'updated';
                return `Sprint ${displayName} status changed to ${status} by ${userName}`;
            }
            return `Sprint ${displayName} updated by ${userName}`;
        }
        if (action === 'deleted') return `Sprint ${displayName} deleted by ${userName}`;
    }

    // Default Fallback
    return `${displayName} ${action} by ${userName}`;
};
