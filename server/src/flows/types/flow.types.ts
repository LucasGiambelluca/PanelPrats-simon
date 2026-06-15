export interface FlowDefinition {
    id: string;
    flow_id: string; // Compatibility
    name: string;
    description?: string;
    trigger_word?: string;
    trigger_type?: 'exact' | 'contains' | 'regex';
    is_active: boolean;
    is_default: boolean;
    nodes: FlowNode[];
    edges: FlowEdge[];
    states?: any; // Legacy compatibility
}

export interface FlowNode {
    id: string;
    type: string; // 'send_message', 'wait_input', etc.
    data: Record<string, any>;
    position: { x: number; y: number };
}

export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
}

export interface FlowExecution {
    id?: string;
    flow_id: string;
    phone: string;
    current_node_id: string;
    status: 'active' | 'completed' | 'error';
    context: Record<string, any>;
    started_at: string;
}

export interface ExecutionResult {
    messages?: string[];
    wait_for_input?: boolean;
    next_node_id?: string;
    updated_context?: Record<string, any>;
    error?: string;
}

export interface FlowTrigger {
    intent?: string;
    keyword?: string[];
}

export interface FlowState {
    message_template?: string;
    actions?: FlowAction[];
    transitions: FlowTransition[];
    final?: boolean;
}

export interface FlowAction {
    type: string;
    [key: string]: any;
}

export interface FlowTransition {
    on: string;
    target: string;
}
