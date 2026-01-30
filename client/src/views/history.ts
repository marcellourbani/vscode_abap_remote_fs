export class History<T>{
    private queue: T[]
    private index = 0
    get current(): T | undefined {
        return this.queue[this.index]
    }
    get hasPrevious() {
        return this.index > 0
    }
    get hasNext() {
        return this.index < this.queue.length - 1
    }
    constructor(item?: T) {
        this.queue = item ? [item] : []
    }

    public append(item: T) {
        if (this.queue.length) {
            if (this.index < this.queue.length - 1) this.queue.splice(this.index + 1)
            this.index++
        } else this.index = 0
        this.queue.push(item)
    }
    public back() {
        if (this.index > 0) this.index--
    }
    public forward() {
        if (this.index < this.queue.length - 1) this.index++
    }
}