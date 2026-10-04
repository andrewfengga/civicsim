/**
 * A minimal binary min-heap specialized for Dijkstra: keys are node
 * indices (0..n-1), priorities are travel times in seconds.
 *
 * Why a hand-rolled heap instead of a generic priority-queue package: this
 * is the inner loop that runs on every station drag during the live demo,
 * so it needs to avoid allocation and boxing. A typed-array-backed heap
 * with no external dependency also means the whole engine has zero npm
 * dependencies, which keeps the bundle small and avoids version-skew for
 * a five-week project.
 */
export class BinaryHeap {
    constructor(maxNodes) {
        this.size = 0;
        this.heap = new Int32Array(maxNodes);
        this.priority = new Float64Array(maxNodes).fill(Infinity);
        this.position = new Int32Array(maxNodes).fill(-1);
    }
    get length() {
        return this.size;
    }
    /** Reset for reuse without reallocating the backing arrays. */
    clear() {
        this.size = 0;
        this.priority.fill(Infinity);
        this.position.fill(-1);
    }
    push(node, dist) {
        if (this.position[node] !== -1) {
            this.decreaseKey(node, dist);
            return;
        }
        const i = this.size++;
        this.heap[i] = node;
        this.priority[node] = dist;
        this.position[node] = i;
        this.bubbleUp(i);
    }
    decreaseKey(node, dist) {
        if (dist >= this.priority[node])
            return; // no-op if not actually smaller
        this.priority[node] = dist;
        this.bubbleUp(this.position[node]);
    }
    popMin() {
        if (this.size === 0)
            return null;
        const minNode = this.heap[0];
        const minDist = this.priority[minNode];
        this.size--;
        if (this.size > 0) {
            this.heap[0] = this.heap[this.size];
            this.position[this.heap[0]] = 0;
            this.bubbleDown(0);
        }
        this.position[minNode] = -1;
        return { node: minNode, dist: minDist };
    }
    bubbleUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.priority[this.heap[parent]] <= this.priority[this.heap[i]])
                break;
            this.swap(i, parent);
            i = parent;
        }
    }
    bubbleDown(i) {
        const n = this.size;
        for (;;) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let smallest = i;
            if (left < n && this.priority[this.heap[left]] < this.priority[this.heap[smallest]])
                smallest = left;
            if (right < n && this.priority[this.heap[right]] < this.priority[this.heap[smallest]])
                smallest = right;
            if (smallest === i)
                break;
            this.swap(i, smallest);
            i = smallest;
        }
    }
    swap(i, j) {
        const ni = this.heap[i];
        const nj = this.heap[j];
        this.heap[i] = nj;
        this.heap[j] = ni;
        this.position[nj] = i;
        this.position[ni] = j;
    }
}
//# sourceMappingURL=binaryHeap.js.map