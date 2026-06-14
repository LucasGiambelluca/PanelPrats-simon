export interface ExecutionContext {
    phone: string;
    // Variables dinámicas del flujo
    [key: string]: any;
}

export interface NodeExecutionResult {
    // Mensajes a enviar al usuario (pueden ser strings o objetos complejos como encuestas)
    messages: any[];
    // Siguiente nodo a ejecutar (si null, el motor decide basado en edges)
    nextNodeId?: string | null;
    // Si true, el motor detiene la ejecución y espera input del usuario
    wait_for_input: boolean;
    // Datos temporales para actualizar el contexto (merge)
    updatedContext?: Partial<ExecutionContext>;
    // Resultado para condiciones (true/false) o intents (string: "pedido", "consulta", etc.)
    conditionResult?: boolean | string;
}

export interface NodeExecutor {
    execute(
        data: any, // Configuración del nodo (flow.nodes[i].data)
        context: ExecutionContext,
        engine: any // Referencia al motor para acceso a servicios (db, orders, etc)
    ): Promise<NodeExecutionResult>;

    // Opcional: Procesar input específico para este nodo (ej: búsqueda de stock, validación de DNI)
    handleInput?(
        input: string,
        data: any,
        context: ExecutionContext
    ): Promise<{
        updatedContext?: Partial<ExecutionContext>;
        messages?: string[];
        isValidInput?: boolean;
    }>;
}
